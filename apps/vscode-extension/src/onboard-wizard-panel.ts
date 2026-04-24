import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import {
  findPersonaTemplate,
  listPersonaTemplates,
  MCPDef as MCPDefSchema,
  type AgentDef,
  type AgentPermissions,
  type MCPDef,
} from '@ujima/shared';
import {
  buildPermissionPreset,
  connectMCP,
  instantiateFromRegistry,
  listRegistry,
  type PermissionPreset,
} from '@ujima/mcp-client';
import { createMockProvider, selectProvider, textTurn, type LLMProvider } from '@ujima/llm/legacy';
import { detectAvailableModels } from './model-detection';
import { createVscodeLmProvider } from './vscode-lm-provider';
import type { SessionController } from './session-controller';

interface PanelOptions {
  channel: vscode.OutputChannel;
  controller: SessionController;
}

interface WizardState {
  mcpId?: string;
  mcpName?: string;
  customPersonaName?: string;
  customPersonaText?: string;
  personaId?: string;
  agentId?: string;
  model?: string;
  preset?: PermissionPreset;
  allowedTools?: string[];
  blockedTools?: string[];
  escalationConditions?: string[];
  escalateTo?: string;
  testPassed?: boolean;
}

type FromWebview =
  | { type: 'ready' }
  | { type: 'loadMcps' }
  | { type: 'loadPersonas' }
  | { type: 'loadModels' }
  | { type: 'listTools'; mcpId: string }
  | { type: 'runTest'; state: WizardState }
  | { type: 'save'; state: WizardState }
  | { type: 'cancel' };

export class OnboardWizardPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private currentMcpDef: MCPDef | undefined;

  constructor(private readonly opts: PanelOptions) {}

  reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'ujima.onboardWizard',
      'Ujima — Onboard Agent',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel = panel;
    panel.webview.html = this.renderHtml(panel.webview);
    panel.onDidDispose(() => {
      this.panel = undefined;
      for (const d of this.disposables) d.dispose();
      this.disposables.length = 0;
    });
    panel.webview.onDidReceiveMessage((msg: FromWebview) => void this.handle(msg), undefined, this.disposables);
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private async handle(msg: FromWebview): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.post({ type: 'hello' });
        return;
      case 'loadMcps': {
        const curated = listRegistry().map((e) => ({
          id: e.id,
          name: e.name,
          description: e.description,
          category: e.category,
          source: 'curated' as const,
        }));
        const customRaw = vscode.workspace.getConfiguration('ujima.mcp').get<unknown[]>('custom') ?? [];
        const custom = customRaw
          .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
          .filter((e) => typeof e.id === 'string' && !!e.id)
          .map((e) => ({
            id: String(e.id),
            name: String(e.name ?? e.id),
            description: String(e.description ?? 'Custom MCP'),
            category: String(e.category ?? 'custom'),
            source: 'custom' as const,
          }));
        this.post({ type: 'mcps', curated, custom });
        return;
      }
      case 'loadPersonas':
        this.post({ type: 'personas', personas: listPersonaTemplates() });
        return;
      case 'loadModels': {
        const models = await detectAvailableModels();
        this.post({ type: 'models', models });
        return;
      }
      case 'listTools': {
        try {
          const def = this.resolveMcpDef(msg.mcpId);
          this.currentMcpDef = def;
          const conn = await connectMCP(def);
          try {
            const tools = await conn.listTools();
            const entry = listRegistry().find((e) => e.id === msg.mcpId);
            this.post({
              type: 'tools',
              tools: tools.map((t) => t.name),
              destructive: entry?.knownDestructiveTools ?? [],
            });
          } finally {
            await conn.close();
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.post({ type: 'toolsError', message });
        }
        return;
      }
      case 'runTest': {
        const result = await this.runTest(msg.state);
        this.post({ type: 'testResult', ...result });
        return;
      }
      case 'save': {
        try {
          const targetFile = await this.saveAgent(msg.state);
          this.post({ type: 'saved', filePath: targetFile.fsPath });
          const open = await vscode.window.showInformationMessage(
            `Ujima: saved agent ${msg.state.agentId}.`,
            'Open file',
          );
          if (open === 'Open file') {
            const doc = await vscode.workspace.openTextDocument(targetFile);
            await vscode.window.showTextDocument(doc);
          }
          this.panel?.dispose();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.post({ type: 'saveError', message });
        }
        return;
      }
      case 'cancel':
        this.panel?.dispose();
        return;
    }
  }

  private resolveMcpDef(mcpId: string): MCPDef {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error('Open a workspace folder first.');
    const customRaw = vscode.workspace.getConfiguration('ujima.mcp').get<unknown[]>('custom') ?? [];
    const customMatch = customRaw.find(
      (e): e is Record<string, unknown> => typeof e === 'object' && e !== null && (e as { id?: unknown }).id === mcpId,
    );
    if (customMatch) {
      return MCPDefSchema.parse(customMatch);
    }
    const subs: Record<string, string> = {};
    if (mcpId === 'filesystem') subs.rootDir = folder.uri.fsPath;
    if (mcpId === 'sqlite') subs.dbPath = vscode.Uri.joinPath(folder.uri, 'users.db').fsPath;
    return instantiateFromRegistry(mcpId, { argSubstitutions: subs });
  }

  private async runTest(
    state: WizardState,
  ): Promise<{ mcpOk: boolean; llmOk: boolean; reply?: string; error?: string }> {
    let mcpOk = false;
    let llmOk = false;
    let reply = '';
    try {
      if (!state.mcpId) throw new Error('no MCP selected');
      if (!state.model) throw new Error('no model selected');
      const def = this.currentMcpDef ?? this.resolveMcpDef(state.mcpId);
      const conn = await connectMCP(def);
      try {
        await conn.listTools();
        mcpOk = true;
      } finally {
        await conn.close();
      }
      const persona = state.personaId
        ? findPersonaTemplate(state.personaId)?.persona ?? 'You are a helpful assistant.'
        : state.customPersonaText ?? 'You are a helpful assistant.';
      const provider = this.pickProviderForTest();
      const stream = provider.stream({
        messages: [
          { role: 'system', content: persona },
          { role: 'user', content: 'Introduce yourself in one sentence.' },
        ],
        model: state.model,
      });
      for await (const delta of stream) {
        if (delta.type === 'text') reply += delta.text;
      }
      llmOk = reply.trim().length > 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { mcpOk, llmOk, error: message };
    }
    return { mcpOk, llmOk, reply: reply.trim().slice(0, 280) };
  }

  private pickProviderForTest(): LLMProvider {
    try {
      return selectProvider({
        order: ['vscode-lm', 'anthropic', 'openai-compat', 'ollama'],
        config: { vscodeLmProvider: createVscodeLmProvider({ channel: this.opts.channel }) },
      });
    } catch {
      return createMockProvider({
        script: [textTurn('(mock) no LLM configured — set an API key, install Copilot, or run Ollama to test for real.')],
      });
    }
  }

  private async saveAgent(state: WizardState): Promise<vscode.Uri> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error('Open a workspace folder first.');
    if (!state.mcpId || !state.agentId || !state.model) throw new Error('Wizard state is incomplete.');

    const persona = state.personaId ? findPersonaTemplate(state.personaId) : undefined;
    const permissions: AgentPermissions = buildPermissionPreset(
      state.mcpId,
      state.preset ?? 'read_only',
      {
        discoveredTools: state.allowedTools && state.allowedTools.length > 0 ? state.allowedTools : undefined,
      },
    );
    if (state.allowedTools && state.allowedTools.length > 0) {
      permissions.allowed_tools = state.allowedTools;
    }
    if (state.blockedTools) permissions.blocked_tools = state.blockedTools;

    const escalation = {
      conditions: state.escalationConditions ?? [],
      escalate_to: state.escalateTo ?? 'human',
    };

    const agent: AgentDef = persona
      ? {
          id: state.agentId,
          name: persona.name,
          persona: persona.persona,
          model: state.model,
          mcp: state.mcpId,
          permissions,
          communication: { publishes: persona.defaultPublishes, subscribes: persona.defaultSubscribes },
          escalation,
          seniority: persona.seniority,
          reviews: persona.reviews,
        }
      : {
          id: state.agentId,
          name: state.customPersonaName ?? state.agentId,
          persona: state.customPersonaText ?? 'You are a helpful assistant.',
          model: state.model,
          mcp: state.mcpId,
          permissions,
          communication: { publishes: [], subscribes: [] },
          escalation,
          seniority: 'junior',
        };

    const targetDir = vscode.Uri.joinPath(folder.uri, '.ujima', 'agents');
    const targetFile = vscode.Uri.joinPath(targetDir, `${state.agentId}.json`);
    try {
      await vscode.workspace.fs.stat(targetFile);
      const ok = await vscode.window.showWarningMessage(
        `${state.agentId}.json already exists. Overwrite?`,
        { modal: true },
        'Overwrite',
      );
      if (ok !== 'Overwrite') throw new Error('Save canceled — file exists.');
    } catch (err) {
      if (err instanceof Error && err.message === 'Save canceled — file exists.') throw err;
    }
    await vscode.workspace.fs.createDirectory(targetDir);
    await vscode.workspace.fs.writeFile(
      targetFile,
      new TextEncoder().encode(JSON.stringify(agent, null, 2)),
    );
    this.opts.controller.upsertAgent({
      id: agent.id,
      name: agent.name,
      mcp: agent.mcp,
      status: 'idle',
      lastAction: 'onboarded',
      tokensUsed: 0,
      tokenCap: permissions.rate_limit.max_session_tokens,
      permissions,
    });
    this.opts.channel.appendLine(
      `[onboard-wizard] saved ${targetFile.fsPath} (persona=${state.personaId ?? 'custom'} mcp=${state.mcpId} model=${state.model})`,
    );
    return targetFile;
  }

  private post(msg: unknown): void {
    this.panel?.webview.postMessage(msg);
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Onboard Agent</title>
<style>${STYLES}</style>
</head>
<body>
<div id="app">
  <div id="stepper"></div>
  <div id="step-body"></div>
  <div id="nav">
    <button id="back-btn">Back</button>
    <div id="nav-status"></div>
    <button id="next-btn" class="primary">Next</button>
  </div>
</div>
<script nonce="${nonce}">${CLIENT_JS}</script>
</body>
</html>`;
  }
}

const STYLES = `
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
#app { max-width: 720px; margin: 0 auto; padding: 1.5rem; display: flex; flex-direction: column; gap: 1.25rem; min-height: 100vh; }
#stepper { display: flex; gap: .35rem; flex-wrap: wrap; }
.step-dot { flex: 1; min-width: 60px; text-align: center; padding: .35rem .5rem; font-size: .72rem; border-radius: 4px; background: var(--vscode-editorWidget-background); opacity: .55; border: 1px solid transparent; }
.step-dot.active { opacity: 1; border-color: var(--vscode-focusBorder); color: var(--vscode-focusBorder); }
.step-dot.done { opacity: .9; background: var(--vscode-charts-green, #3fb950); color: #fff; }
#step-body { flex: 1; padding: 1rem 1.25rem; background: var(--vscode-editorWidget-background); border-radius: 6px; }
h2 { margin: 0 0 .25rem; font-size: 1.1rem; }
.hint { opacity: .75; font-size: .82rem; margin-bottom: 1rem; }
.option { display: block; padding: .7rem .85rem; margin-bottom: .4rem; border: 1px solid var(--vscode-panel-border); border-radius: 5px; cursor: pointer; transition: border-color .12s; }
.option:hover { border-color: var(--vscode-focusBorder); }
.option.selected { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.option .opt-title { font-weight: 600; display: flex; justify-content: space-between; }
.option .opt-title .badge { font-size: .68rem; padding: .1rem .45rem; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 3px; font-weight: 400; }
.option .opt-desc { font-size: .8rem; opacity: .8; margin-top: .25rem; }
label { display: block; font-size: .82rem; margin-bottom: .35rem; font-weight: 500; }
input[type=text], textarea, select { width: 100%; padding: .5rem .7rem; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 4px; font-family: inherit; font-size: .88rem; }
textarea { min-height: 100px; resize: vertical; font-family: var(--vscode-editor-font-family, monospace); }
.field { margin-bottom: .85rem; }
.checklist { max-height: 280px; overflow-y: auto; border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: .5rem; }
.check-row { display: flex; align-items: center; gap: .5rem; padding: .25rem .35rem; font-size: .85rem; border-radius: 3px; }
.check-row:hover { background: var(--vscode-list-hoverBackground); }
.check-row input { width: auto; }
.check-row .destructive { color: var(--vscode-charts-yellow, #d29922); font-size: .7rem; margin-left: auto; }
#nav { display: flex; gap: .75rem; align-items: center; }
#nav-status { flex: 1; font-size: .78rem; opacity: .75; }
button { padding: .45rem 1rem; font-size: .85rem; border: 1px solid var(--vscode-panel-border); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-radius: 4px; cursor: pointer; font-family: inherit; }
button:disabled { opacity: .45; cursor: not-allowed; }
button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
button:hover:not(:disabled) { opacity: .9; }
.preview { margin-top: 1rem; padding: .6rem .8rem; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; font-family: var(--vscode-editor-font-family, monospace); font-size: .75rem; white-space: pre-wrap; max-height: 220px; overflow-y: auto; }
.test-line { padding: .3rem 0; font-size: .85rem; }
.test-ok { color: var(--vscode-charts-green, #3fb950); }
.test-fail { color: var(--vscode-charts-red, #f85149); }
.test-reply { margin-top: .75rem; padding: .65rem; background: var(--vscode-editor-background); border-radius: 4px; font-size: .85rem; line-height: 1.45; border-left: 3px solid var(--vscode-focusBorder); }
.loading { opacity: .7; font-style: italic; font-size: .85rem; padding: .5rem 0; }
`;

const CLIENT_JS = `(() => {
const vscode = acquireVsCodeApi();
const STEPS = [
  { id: 'mcp',        title: 'Connect MCP',       short: 'MCP' },
  { id: 'name',       title: 'Name + id',         short: 'Name' },
  { id: 'persona',    title: 'Persona',           short: 'Persona' },
  { id: 'model',      title: 'Model',             short: 'Model' },
  { id: 'permissions',title: 'Permissions',       short: 'Perms' },
  { id: 'escalation', title: 'Escalation',        short: 'Escalate' },
  { id: 'test',       title: 'Test connection',   short: 'Test' },
  { id: 'save',       title: 'Review & save',     short: 'Save' },
];
const state = {};
let stepIdx = 0;
let mcps = null;
let personas = null;
let models = null;
let tools = null;
let testResult = null;
let busy = false;

const stepperEl = document.getElementById('stepper');
const bodyEl = document.getElementById('step-body');
const navStatus = document.getElementById('nav-status');
const backBtn = document.getElementById('back-btn');
const nextBtn = document.getElementById('next-btn');

backBtn.addEventListener('click', () => { if (stepIdx > 0) { stepIdx--; render(); } });
nextBtn.addEventListener('click', () => {
  if (stepIdx < STEPS.length - 1) { stepIdx++; render(); return; }
  vscode.postMessage({ type: 'save', state: state });
  busy = true; nextBtn.disabled = true; nextBtn.textContent = 'Saving…';
});

window.addEventListener('message', (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'hello': vscode.postMessage({ type: 'loadMcps' }); return;
    case 'mcps': mcps = { curated: msg.curated, custom: msg.custom }; render(); return;
    case 'personas': personas = msg.personas; render(); return;
    case 'models': models = msg.models; render(); return;
    case 'tools': tools = { names: msg.tools, destructive: msg.destructive }; render(); return;
    case 'toolsError': tools = { error: msg.message }; render(); return;
    case 'testResult': testResult = msg; state.testPassed = !!(msg.mcpOk && msg.llmOk); render(); return;
    case 'saved': navStatus.textContent = 'Saved to ' + msg.filePath; return;
    case 'saveError':
      busy = false; nextBtn.disabled = false; nextBtn.textContent = 'Save';
      navStatus.textContent = 'Save failed: ' + msg.message;
      return;
  }
});

function renderStepper() {
  stepperEl.innerHTML = STEPS.map((s, i) => {
    const cls = i < stepIdx ? 'step-dot done' : i === stepIdx ? 'step-dot active' : 'step-dot';
    return '<div class="' + cls + '">' + (i+1) + '. ' + s.short + '</div>';
  }).join('');
}

function canAdvance() {
  switch (STEPS[stepIdx].id) {
    case 'mcp': return !!state.mcpId;
    case 'name': return /^[a-zA-Z0-9_-]+$/.test(state.agentId || '');
    case 'persona': return !!state.personaId || (!!state.customPersonaName && !!state.customPersonaText);
    case 'model': return !!state.model;
    case 'permissions': return !!state.preset;
    case 'escalation': return true;
    case 'test': return true;
    case 'save': return true;
  }
  return false;
}

function render() {
  renderStepper();
  const step = STEPS[stepIdx];
  backBtn.disabled = stepIdx === 0;
  nextBtn.disabled = busy || !canAdvance();
  nextBtn.textContent = stepIdx === STEPS.length - 1 ? 'Save' : 'Next →';
  switch (step.id) {
    case 'mcp': return renderMcp();
    case 'name': return renderName();
    case 'persona': return renderPersona();
    case 'model': return renderModel();
    case 'permissions': return renderPermissions();
    case 'escalation': return renderEscalation();
    case 'test': return renderTest();
    case 'save': return renderSave();
  }
}

function h(html) { bodyEl.innerHTML = html; }

function renderMcp() {
  if (!mcps) { h('<h2>Connect MCP</h2><div class="loading">Loading registry…</div>'); return; }
  const makeCard = (m, source) => {
    const selected = state.mcpId === m.id ? ' selected' : '';
    return '<div class="option' + selected + '" data-id="' + escapeAttr(m.id) + '" data-name="' + escapeAttr(m.name) + '">' +
      '<div class="opt-title">' + escapeHtml(m.name) + '<span class="badge">' + source + ' · ' + escapeHtml(m.category) + '</span></div>' +
      '<div class="opt-desc">' + escapeHtml(m.description) + '</div></div>';
  };
  h('<h2>Step 1 — Connect MCP</h2>' +
    '<div class="hint">Pick the MCP server this agent will control. Custom entries come from your <code>ujima.mcp.custom</code> setting.</div>' +
    (mcps.custom.length ? '<div><label>Custom</label>' + mcps.custom.map((m) => makeCard(m, 'custom')).join('') + '</div>' : '') +
    '<div><label>Curated</label>' + mcps.curated.map((m) => makeCard(m, 'curated')).join('') + '</div>');
  bodyEl.querySelectorAll('.option').forEach((el) => {
    el.addEventListener('click', () => {
      state.mcpId = el.getAttribute('data-id') || undefined;
      state.mcpName = el.getAttribute('data-name') || undefined;
      tools = null;
      render();
    });
  });
}

function renderName() {
  const defaultId = state.mcpId ? (state.mcpId.replace(/[^a-z0-9]/gi, '-') + '-1') : 'agent-1';
  if (!state.agentId) state.agentId = defaultId;
  h('<h2>Step 2 — Name the agent</h2>' +
    '<div class="hint">The id identifies this agent in teams and logs. Use letters, digits, hyphens, or underscores.</div>' +
    '<div class="field"><label>Agent id</label><input type="text" id="agent-id" value="' + escapeAttr(state.agentId) + '" /></div>');
  const input = document.getElementById('agent-id');
  input.addEventListener('input', () => { state.agentId = input.value.trim(); nextBtn.disabled = !canAdvance(); });
}

function renderPersona() {
  if (!personas) { vscode.postMessage({ type: 'loadPersonas' }); h('<h2>Persona</h2><div class="loading">Loading personas…</div>'); return; }
  const cards = personas.map((p) => {
    const sel = state.personaId === p.id ? ' selected' : '';
    return '<div class="option' + sel + '" data-id="' + escapeAttr(p.id) + '">' +
      '<div class="opt-title">' + escapeHtml(p.name) + '<span class="badge">' + escapeHtml(p.seniority) + ' · ' + escapeHtml(p.suggestedMcp) + '</span></div>' +
      '<div class="opt-desc">' + escapeHtml(p.role) + '</div></div>';
  }).join('');
  const customSel = !state.personaId && state.customPersonaText ? ' selected' : '';
  h('<h2>Step 3 — Pick a persona</h2>' +
    '<div class="hint">Curated personas come with sensible defaults for publishes / subscribes / seniority. Pick "Write my own" to customize.</div>' +
    cards +
    '<div class="option' + customSel + '" id="custom-persona-card"><div class="opt-title">Write my own persona</div><div class="opt-desc">Define display name + system prompt manually.</div></div>' +
    (state.personaId ? '' :
      '<div style="margin-top:1rem;">' +
        '<div class="field"><label>Name</label><input type="text" id="custom-name" value="' + escapeAttr(state.customPersonaName || '') + '" placeholder="e.g. Docs Writer" /></div>' +
        '<div class="field"><label>System prompt</label><textarea id="custom-text" placeholder="You are a … your job is to …">' + escapeHtml(state.customPersonaText || '') + '</textarea></div>' +
      '</div>'));
  bodyEl.querySelectorAll('.option[data-id]').forEach((el) => {
    el.addEventListener('click', () => {
      state.personaId = el.getAttribute('data-id') || undefined;
      state.customPersonaName = undefined;
      state.customPersonaText = undefined;
      render();
    });
  });
  const customCard = document.getElementById('custom-persona-card');
  if (customCard) customCard.addEventListener('click', () => { state.personaId = undefined; render(); });
  const nameIn = document.getElementById('custom-name');
  const textIn = document.getElementById('custom-text');
  if (nameIn) nameIn.addEventListener('input', () => { state.customPersonaName = nameIn.value.trim(); nextBtn.disabled = !canAdvance(); });
  if (textIn) textIn.addEventListener('input', () => { state.customPersonaText = textIn.value.trim(); nextBtn.disabled = !canAdvance(); });
}

function renderModel() {
  if (!models) { vscode.postMessage({ type: 'loadModels' }); h('<h2>Model</h2><div class="loading">Detecting available models…</div>'); return; }
  const cards = models.map((m) => {
    const sel = state.model === m.id ? ' selected' : '';
    const badge = m.available ? 'available' : 'not available';
    return '<div class="option' + sel + '" data-id="' + escapeAttr(m.id) + '">' +
      '<div class="opt-title">' + escapeHtml(m.label) + '<span class="badge">' + badge + '</span></div>' +
      '<div class="opt-desc">' + escapeHtml(m.description) + '</div></div>';
  }).join('');
  h('<h2>Step 4 — Pick a model</h2>' +
    '<div class="hint">Detected from VS Code LM API, environment variables, and local Ollama. You can still pick an unavailable one — it will fail at runtime until configured.</div>' +
    cards);
  bodyEl.querySelectorAll('.option').forEach((el) => {
    el.addEventListener('click', () => { state.model = el.getAttribute('data-id') || undefined; render(); });
  });
}

function renderPermissions() {
  const presets = [
    { id: 'read_only', name: 'Read only', desc: 'Only get/list/search/read-like tools. Safe for observation tasks.' },
    { id: 'read_write', name: 'Read + write', desc: 'Everything minus known destructive tools (delete, drop, rm, etc.).' },
    { id: 'full', name: 'Full access', desc: 'Every tool, no blocks. Use only for trusted agents.' },
  ];
  const loadTools = state.mcpId && !tools;
  if (loadTools) vscode.postMessage({ type: 'listTools', mcpId: state.mcpId });
  const cards = presets.map((p) => {
    const sel = state.preset === p.id ? ' selected' : '';
    return '<div class="option' + sel + '" data-id="' + escapeAttr(p.id) + '">' +
      '<div class="opt-title">' + escapeHtml(p.name) + '</div>' +
      '<div class="opt-desc">' + escapeHtml(p.desc) + '</div></div>';
  }).join('');
  let toolListHtml = '';
  if (tools && tools.error) {
    toolListHtml = '<div class="hint" style="color:var(--vscode-charts-red);">Could not list tools: ' + escapeHtml(tools.error) + '. Preset will still be applied, but tool list refinement is unavailable.</div>';
  } else if (tools && tools.names) {
    toolListHtml = '<label>Tools (tick to allow)</label><div class="checklist">' +
      tools.names.map((name) => {
        const isDest = tools.destructive.includes(name);
        const allowed = state.allowedTools ? state.allowedTools.includes(name) : !isDest;
        return '<label class="check-row"><input type="checkbox" data-tool="' + escapeAttr(name) + '"' + (allowed ? ' checked' : '') + ' />' +
          escapeHtml(name) + (isDest ? '<span class="destructive">destructive</span>' : '') + '</label>';
      }).join('') + '</div>';
  } else if (loadTools) {
    toolListHtml = '<div class="loading">Probing tools from MCP…</div>';
  }
  h('<h2>Step 5 — Permissions</h2>' +
    '<div class="hint">Presets set defaults; the tool list below overrides them per-tool.</div>' +
    cards + toolListHtml);
  bodyEl.querySelectorAll('.option').forEach((el) => {
    el.addEventListener('click', () => { state.preset = el.getAttribute('data-id'); render(); });
  });
  bodyEl.querySelectorAll('.check-row input').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (!tools || !tools.names) return;
      const allowed = [];
      const blocked = [];
      bodyEl.querySelectorAll('.check-row input').forEach((x) => {
        const name = x.getAttribute('data-tool') || '';
        if (x.checked) allowed.push(name); else blocked.push(name);
      });
      state.allowedTools = allowed;
      state.blockedTools = blocked;
    });
  });
}

function renderEscalation() {
  const conds = ['requires_approval','destructive_action','high_cost','unknown_tool','out_of_scope','ambiguous_request'];
  if (!state.escalationConditions) state.escalationConditions = ['requires_approval','destructive_action'];
  if (!state.escalateTo) state.escalateTo = 'human';
  h('<h2>Step 6 — Escalation</h2>' +
    '<div class="hint">When these conditions fire, the agent hands off to the recipient.</div>' +
    '<label>Conditions</label><div class="checklist">' +
    conds.map((c) => {
      const on = state.escalationConditions.includes(c);
      return '<label class="check-row"><input type="checkbox" data-cond="' + c + '"' + (on ? ' checked' : '') + ' />' + c + '</label>';
    }).join('') +
    '</div>' +
    '<div class="field" style="margin-top:1rem;"><label>Escalate to</label>' +
    '<input type="text" id="esc-to" value="' + escapeAttr(state.escalateTo) + '" placeholder="human, or an existing agent id" />' +
    '</div>');
  bodyEl.querySelectorAll('input[data-cond]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const arr = [];
      bodyEl.querySelectorAll('input[data-cond]').forEach((x) => { if (x.checked) arr.push(x.getAttribute('data-cond')); });
      state.escalationConditions = arr;
    });
  });
  document.getElementById('esc-to').addEventListener('input', (e) => { state.escalateTo = e.target.value.trim(); });
}

function renderTest() {
  const runBtn = '<button id="run-test-btn" class="primary">Run connection test</button>';
  let result = '';
  if (testResult) {
    result = '<div class="test-line ' + (testResult.mcpOk ? 'test-ok' : 'test-fail') + '">MCP: ' + (testResult.mcpOk ? '✅ connected' : '❌ failed') + '</div>' +
      '<div class="test-line ' + (testResult.llmOk ? 'test-ok' : 'test-fail') + '">LLM: ' + (testResult.llmOk ? '✅ responded' : '❌ no response') + '</div>' +
      (testResult.error ? '<div class="test-line test-fail">Error: ' + escapeHtml(testResult.error) + '</div>' : '') +
      (testResult.reply ? '<div class="test-reply">' + escapeHtml(testResult.reply) + '</div>' : '');
  }
  h('<h2>Step 7 — Test connection</h2>' +
    '<div class="hint">Spawns the MCP briefly, sends a one-line intro prompt to the model, and checks both respond. You can skip this step.</div>' +
    runBtn + '<div style="margin-top:1rem;">' + result + '</div>');
  document.getElementById('run-test-btn').addEventListener('click', () => {
    testResult = null;
    bodyEl.querySelector('#run-test-btn').disabled = true;
    bodyEl.querySelector('#run-test-btn').textContent = 'Testing…';
    vscode.postMessage({ type: 'runTest', state: state });
  });
}

function renderSave() {
  const preview = JSON.stringify(buildPreview(), null, 2);
  h('<h2>Step 8 — Review & save</h2>' +
    '<div class="hint">This is what will be written to <code>.ujima/agents/' + escapeHtml(state.agentId || 'agent') + '.json</code>.</div>' +
    '<div class="preview">' + escapeHtml(preview) + '</div>');
}

function buildPreview() {
  const persona = state.personaId ? (personas || []).find((p) => p.id === state.personaId) : null;
  return {
    id: state.agentId,
    name: persona ? persona.name : state.customPersonaName || state.agentId,
    model: state.model,
    mcp: state.mcpId,
    preset: state.preset,
    allowed_tools: state.allowedTools,
    escalation: { conditions: state.escalationConditions || [], escalate_to: state.escalateTo || 'human' },
  };
}

function escapeHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escapeAttr(s) { return String(s || '').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

vscode.postMessage({ type: 'ready' });
render();
})();`;
