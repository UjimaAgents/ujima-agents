import * as vscode from 'vscode';
import {
  findPersonaTemplate,
  listPersonaTemplates,
  type AgentDef,
  type AgentPermissions,
  type MCPDef,
  type PersonaTemplate,
} from '@ujima/shared';
import {
  connectMCP,
  instantiateFromRegistry,
  isDestructive,
  listRegistry,
  type RegistryEntry,
} from '@ujima/mcp-client';
import { createMockProvider, selectProvider, textTurn, type LLMProvider } from '@ujima/llm/legacy';
import type { SessionController } from './session-controller';
import { detectAvailableModels } from './model-detection';
import { createVscodeLmProvider } from './vscode-lm-provider';

interface McpChoice {
  entry: RegistryEntry;
  def: MCPDef;
  source: 'curated' | 'custom' | 'custom-overrides-curated';
}

interface PersonaChoice {
  kind: 'template';
  template: PersonaTemplate;
}
interface CustomPersona {
  kind: 'custom';
  name: string;
  persona: string;
}

const DEFAULT_RATE_LIMIT: AgentPermissions['rate_limit'] = {
  calls_per_minute: 30,
  max_session_tokens: 100_000,
};

export async function onboardAgentCommand(
  channel: vscode.OutputChannel,
  controller: SessionController,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage('Ujima: open a workspace folder first — agents save to .ujima/agents/.');
    return;
  }

  const mcpChoice = await pickMCP(folder.uri);
  if (!mcpChoice) return;

  const tools = await pickTools(mcpChoice, channel);
  if (!tools) return;
  const { allowed, blocked } = tools;

  const persona = await pickPersona(mcpChoice.entry);
  if (!persona) return;

  const model = await pickModel();
  if (!model) return;

  const defaultId = persona.kind === 'template' ? `${persona.template.id}-1` : `${slug(persona.name)}-1`;
  const agentId = await vscode.window.showInputBox({
    title: 'Ujima — Onboard agent · name',
    prompt: 'Agent id (letters, digits, hyphens / underscores)',
    value: defaultId,
    validateInput: (v) => (/^[a-zA-Z0-9_-]+$/.test(v) ? null : 'Use letters/digits/_/- only.'),
    ignoreFocusOut: true,
  });
  if (!agentId) return;

  const permissions: AgentPermissions = {
    allowed_tools: allowed,
    blocked_tools: blocked,
    rate_limit: DEFAULT_RATE_LIMIT,
  };

  const personaDefaultEscalation =
    persona.kind === 'template' ? persona.template.defaultEscalation : undefined;
  const existingAgentIds = await listExistingAgentIds(folder.uri);
  const escalation = await pickEscalation(personaDefaultEscalation, existingAgentIds);
  if (!escalation) return;

  const agent = buildAgent({ agentId, mcpId: mcpChoice.entry.id, model, permissions, persona, escalation });

  await testConnection(agent, mcpChoice.def, channel);

  const targetDir = vscode.Uri.joinPath(folder.uri, '.ujima', 'agents');
  const targetFile = vscode.Uri.joinPath(targetDir, `${agentId}.json`);

  try {
    await vscode.workspace.fs.stat(targetFile);
    const overwrite = await vscode.window.showWarningMessage(
      `${agentId}.json already exists. Overwrite?`,
      { modal: true },
      'Overwrite',
    );
    if (overwrite !== 'Overwrite') return;
  } catch {
    /* not found — good */
  }

  await vscode.workspace.fs.createDirectory(targetDir);
  await vscode.workspace.fs.writeFile(targetFile, new TextEncoder().encode(JSON.stringify(agent, null, 2)));

  controller.upsertAgent({
    id: agent.id,
    name: agent.name,
    mcp: agent.mcp,
    status: 'idle',
    lastAction: 'onboarded',
    tokensUsed: 0,
    tokenCap: permissions.rate_limit.max_session_tokens,
    permissions,
  });

  channel.appendLine(
    `[onboard] saved ${targetFile.fsPath} (persona=${persona.kind === 'template' ? persona.template.id : 'custom'} mcp=${mcpChoice.entry.id} tools=${allowed.length} blocked=${blocked.length})`,
  );
  const openIt = await vscode.window.showInformationMessage(
    `Ujima: saved ${agentId} (${agent.name} · ${mcpChoice.entry.name} · ${allowed.length} tools).`,
    'Open file',
  );
  if (openIt === 'Open file') {
    const doc = await vscode.workspace.openTextDocument(targetFile);
    await vscode.window.showTextDocument(doc);
  }
}

async function pickMCP(workspaceUri: vscode.Uri): Promise<McpChoice | undefined> {
  const envOverrides = readStringRecord(vscode.workspace.getConfiguration('ujima.mcp').get('env'));
  const curated = listRegistry().map<McpChoice>((entry) => ({
    entry,
    def: instantiateFromRegistry(entry.id, {
      argSubstitutions: substitutionsFor(entry.id, workspaceUri),
      envOverrides,
    }),
    source: 'curated',
  }));
  const customs = listCustomMcpChoices();

  // Dedupe: when a custom entry's id normalizes to the same key as a curated one,
  // keep ONLY the custom one (it's what wins at runtime via resolveMCPDef).
  const norm = (s: string): string => s.toLowerCase().replace(/[\s_-]+/g, '');
  const customNormIds = new Set(customs.map((c) => norm(c.entry.id)));
  const filteredCurated = curated.filter((c) => !customNormIds.has(norm(c.entry.id)));
  const curatedNormIds = new Set(curated.map((c) => norm(c.entry.id)));
  const labeledCustoms = customs.map<McpChoice>((c) => ({
    ...c,
    source: curatedNormIds.has(norm(c.entry.id)) ? 'custom-overrides-curated' : 'custom',
  }));
  const ordered = [...labeledCustoms, ...filteredCurated];

  const badge = (s: McpChoice['source']): string => {
    if (s === 'custom') return 'custom';
    if (s === 'custom-overrides-curated') return 'custom · overrides curated';
    return 'curated';
  };
  const icon = (c: McpChoice): string =>
    c.source === 'curated' ? iconFor(c.entry.category) : '$(plug)';

  const pick = await vscode.window.showQuickPick(
    ordered.map((c) => ({
      label: `${icon(c)} ${c.entry.name}`,
      description: `${c.entry.id} · ${badge(c.source)}`,
      detail: c.entry.description,
      choice: c,
    })),
    {
      title: 'Ujima — Onboard agent (1/4) · pick MCP',
      placeHolder: `Pick an MCP server${customs.length ? ` (${customs.length} custom)` : ''}`,
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true,
    },
  );
  return pick?.choice;
}

async function pickTools(
  choice: McpChoice,
  channel: vscode.OutputChannel,
): Promise<{ allowed: string[]; blocked: string[] } | undefined> {
  let toolNames: string[] = [];
  try {
    toolNames = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Listing tools for ${choice.entry.name}…` },
      async () => {
        const conn = await connectMCP(choice.def);
        try {
          return (await conn.listTools()).map((t) => t.name);
        } finally {
          await conn.close();
        }
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    channel.appendLine(`[onboard] listTools failed for ${choice.entry.id}: ${msg}`);
    const manual = await vscode.window.showWarningMessage(
      `Couldn't connect to "${choice.entry.id}": ${msg}. Continue and type tool names manually?`,
      { modal: true },
      'Enter manually',
    );
    if (manual !== 'Enter manually') return undefined;
    const raw = await vscode.window.showInputBox({
      title: `Ujima — Onboard agent (2/4) · tools for ${choice.entry.name}`,
      prompt: 'Comma-separated tool names to allow',
      ignoreFocusOut: true,
    });
    if (!raw) return undefined;
    const allowed = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    return { allowed, blocked: [] };
  }

  if (toolNames.length === 0) {
    void vscode.window.showWarningMessage(`"${choice.entry.id}" exposes no tools.`);
    return { allowed: [], blocked: [] };
  }

  const destructive = new Set(choice.entry.knownDestructiveTools ?? []);
  const items: (vscode.QuickPickItem & { name: string })[] = toolNames.map((name) => ({
    name,
    label: name,
    description: destructive.has(name) ? '$(warning) destructive' : undefined,
    picked: !destructive.has(name),
  }));
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: `Ujima — Onboard agent (2/4) · tools (${toolNames.length} discovered)`,
    placeHolder: 'Tick the tools this agent is allowed to call. Destructive tools are unticked by default.',
    matchOnDescription: true,
    ignoreFocusOut: true,
  });
  if (!picked) return undefined;
  const allowedSet = new Set(picked.map((p) => p.name));
  const allowed = toolNames.filter((t) => allowedSet.has(t));
  const blocked = toolNames.filter((t) => !allowedSet.has(t));
  return { allowed, blocked };
}

async function pickPersona(mcp: RegistryEntry): Promise<PersonaChoice | CustomPersona | undefined> {
  const templates = listPersonaTemplates();
  const suggested = templates.find((t) => t.suggestedMcp === mcp.id);
  const ordered = suggested ? [suggested, ...templates.filter((t) => t.id !== suggested.id)] : templates;

  const CUSTOM_SENTINEL = '__custom__';
  const items: (vscode.QuickPickItem & { id: string; template?: PersonaTemplate })[] = [
    ...ordered.map((t) => ({
      id: t.id,
      template: t,
      label: `${t.id === suggested?.id ? '$(star-full) ' : '$(' + seniorityIcon(t.seniority) + ') '}${t.name}`,
      description: t.role,
      detail: t.persona.split('\n')[0],
    })),
    { id: CUSTOM_SENTINEL, label: '$(edit) Write my own persona…', description: 'Define name + system prompt manually' },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: 'Ujima — Onboard agent (3/4) · persona',
    placeHolder: 'Pick a curated persona or define your own',
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  if (!pick) return undefined;
  if (pick.id !== CUSTOM_SENTINEL && pick.template) return { kind: 'template', template: pick.template };

  const name = await vscode.window.showInputBox({
    title: 'Ujima — Custom persona · name',
    prompt: 'Display name for this agent (e.g. "Docs Writer")',
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim().length > 0 ? null : 'Name is required.'),
  });
  if (!name) return undefined;
  const persona = await vscode.window.showInputBox({
    title: 'Ujima — Custom persona · prompt',
    prompt: 'System prompt / role description',
    placeHolder: 'You are a … your job is to …',
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim().length > 0 ? null : 'Persona text is required.'),
  });
  if (!persona) return undefined;
  return { kind: 'custom', name: name.trim(), persona: persona.trim() };
}

async function pickModel(): Promise<string | undefined> {
  const detected = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Ujima — detecting available models…' },
    () => detectAvailableModels(),
  );
  const items = detected.map((m) => ({
    label: `${m.available ? '$(check)' : '$(circle-slash)'} ${m.label}`,
    description: m.description,
    detail: m.available ? undefined : 'Not currently available — select to use anyway (will fail at runtime).',
    value: m.id,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    title: 'Ujima — Onboard agent · model',
    placeHolder: `${detected.filter((m) => m.available).length} available · pick a model`,
    ignoreFocusOut: true,
    matchOnDescription: true,
  });
  return pick?.value;
}

interface EscalationChoice {
  conditions: string[];
  escalate_to: string;
}

const DEFAULT_ESCALATION_CONDITIONS = [
  'requires_approval',
  'destructive_action',
  'high_cost',
  'unknown_tool',
  'out_of_scope',
  'ambiguous_request',
];

async function pickEscalation(
  personaDefault: { conditions: string[]; escalate_to: string } | undefined,
  existingAgentIds: string[],
): Promise<EscalationChoice | undefined> {
  const defaults = personaDefault ?? { conditions: [], escalate_to: 'human' };
  const allConditions = Array.from(new Set([...DEFAULT_ESCALATION_CONDITIONS, ...defaults.conditions]));

  const conditionPicks = await vscode.window.showQuickPick(
    allConditions.map((c) => ({ label: c, picked: defaults.conditions.includes(c) })),
    {
      canPickMany: true,
      title: 'Ujima — Onboard agent · escalation conditions',
      placeHolder: 'Tick conditions that should trigger an escalation. Leave empty if this agent never escalates.',
      ignoreFocusOut: true,
    },
  );
  if (!conditionPicks) return undefined;
  const conditions = conditionPicks.map((p) => p.label);

  const CUSTOM = '__custom__';
  const recipientItems: (vscode.QuickPickItem & { value: string })[] = [
    { label: '$(person) human', description: 'Pause for human approval in the Governance panel', value: 'human' },
    ...existingAgentIds.map((id) => ({ label: `$(organization) ${id}`, description: 'Route to this agent', value: id })),
    { label: '$(edit) Other…', description: 'Type a recipient manually', value: CUSTOM },
  ];
  const recipientPick = await vscode.window.showQuickPick(recipientItems, {
    title: 'Ujima — Onboard agent · escalate to',
    placeHolder: 'Who receives escalations from this agent?',
    ignoreFocusOut: true,
  });
  if (!recipientPick) return undefined;
  let escalate_to = recipientPick.value;
  if (escalate_to === CUSTOM) {
    const manual = await vscode.window.showInputBox({
      title: 'Ujima — escalation recipient',
      prompt: 'Agent id or "human"',
      value: defaults.escalate_to,
      validateInput: (v) => (v.trim().length > 0 ? null : 'Recipient is required.'),
      ignoreFocusOut: true,
    });
    if (!manual) return undefined;
    escalate_to = manual.trim();
  }
  return { conditions, escalate_to };
}

async function testConnection(
  agent: AgentDef,
  mcpDef: MCPDef,
  channel: vscode.OutputChannel,
): Promise<void> {
  const proceed = await vscode.window.showInformationMessage(
    `Run a quick test turn with "${agent.name}"? This sends a short "introduce yourself" prompt using the chosen model + MCP.`,
    { modal: true },
    'Run test',
    'Skip',
  );
  if (proceed !== 'Run test') return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Testing ${agent.name}…`, cancellable: false },
    async (progress) => {
      let mcpOk = false;
      let llmOk = false;
      let reply = '';
      let errMsg = '';
      try {
        progress.report({ message: 'connecting MCP…' });
        const conn = await connectMCP(mcpDef);
        try {
          await conn.listTools();
          mcpOk = true;
        } finally {
          await conn.close();
        }

        progress.report({ message: 'calling LLM…' });
        const provider = pickProviderForTest(channel);
        const stream = provider.stream({
          messages: [
            { role: 'system', content: agent.persona },
            { role: 'user', content: 'Introduce yourself in one sentence.' },
          ],
          model: agent.model,
        });
        for await (const delta of stream) {
          if (delta.type === 'text') reply += delta.text;
        }
        llmOk = reply.trim().length > 0;
      } catch (err) {
        errMsg = err instanceof Error ? err.message : String(err);
      }

      const summary = [
        `MCP (${agent.mcp}): ${mcpOk ? '✅' : '❌'}`,
        `LLM (${agent.model}): ${llmOk ? '✅' : '❌'}`,
        reply ? `Reply: ${reply.trim().slice(0, 140)}` : '',
        errMsg ? `Error: ${errMsg}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      channel.appendLine(`[onboard] test → ${summary}`);
      if (mcpOk && llmOk) {
        void vscode.window.showInformationMessage(`Ujima: test passed — ${summary}`);
      } else {
        void vscode.window.showWarningMessage(`Ujima: test incomplete — ${summary}`);
      }
    },
  );
}

function pickProviderForTest(channel: vscode.OutputChannel): LLMProvider {
  try {
    return selectProvider({
      order: ['vscode-lm', 'anthropic', 'openai-compat', 'ollama'],
      config: { vscodeLmProvider: createVscodeLmProvider({ channel }) },
    });
  } catch {
    return createMockProvider({ script: [textTurn('(mock) no LLM configured — this is a dry-run response.')] });
  }
}

function buildAgent(args: {
  agentId: string;
  mcpId: string;
  model: string;
  permissions: AgentPermissions;
  persona: PersonaChoice | CustomPersona;
  escalation: EscalationChoice;
}): AgentDef {
  if (args.persona.kind === 'template') {
    const t = findPersonaTemplate(args.persona.template.id) ?? args.persona.template;
    return {
      id: args.agentId,
      name: t.name,
      persona: t.persona,
      model: args.model,
      mcp: args.mcpId,
      permissions: args.permissions,
      communication: { publishes: t.defaultPublishes, subscribes: t.defaultSubscribes },
      escalation: args.escalation,
      seniority: t.seniority,
      reviews: t.reviews,
    };
  }
  return {
    id: args.agentId,
    name: args.persona.name,
    persona: args.persona.persona,
    model: args.model,
    mcp: args.mcpId,
    permissions: args.permissions,
    communication: { publishes: [], subscribes: [] },
    escalation: args.escalation,
    seniority: 'junior',
  };
}

async function listExistingAgentIds(workspace: vscode.Uri): Promise<string[]> {
  const dir = vscode.Uri.joinPath(workspace, '.ujima', 'agents');
  try {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    return entries
      .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json'))
      .map(([name]) => name.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

function listCustomMcpChoices(): McpChoice[] {
  const raw = vscode.workspace.getConfiguration('ujima.mcp').get<unknown[]>('custom') ?? [];
  const envOverrides = readStringRecord(vscode.workspace.getConfiguration('ujima.mcp').get('env'));
  const out: McpChoice[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const def = item as MCPDef;
    if (typeof def.id !== 'string' || !def.id) continue;
    const entry: RegistryEntry = {
      id: def.id,
      name: def.name ?? def.id,
      description: def.description ?? `Custom MCP (${def.transport ?? 'stdio'})`,
      category: def.category ?? 'custom',
      tags: ['custom'],
      defaults: {
        version: def.version ?? '0.0.0',
        description: def.description ?? '',
        category: def.category ?? 'custom',
        transport: def.transport,
        command: def.command,
        args: def.args ?? [],
        env: def.env ?? {},
        url: def.url,
        isolation: def.isolation ?? 'shared',
      },
    };
    const merged: MCPDef = { ...def, env: { ...(def.env ?? {}), ...envOverrides } };
    out.push({ entry, def: merged, source: 'custom' });
  }
  return out;
}

function substitutionsFor(mcpId: string, workspaceUri: vscode.Uri): Record<string, string> {
  const subs: Record<string, string> = {};
  if (mcpId === 'filesystem') subs.rootDir = workspaceUri.fsPath;
  if (mcpId === 'sqlite') subs.dbPath = vscode.Uri.joinPath(workspaceUri, 'users.db').fsPath;
  return subs;
}

function readStringRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

function iconFor(category: string): string {
  switch (category) {
    case 'design':
      return '$(symbol-color)';
    case 'browser':
      return '$(browser)';
    case 'database':
      return '$(database)';
    case 'filesystem':
      return '$(file-directory)';
    default:
      return '$(plug)';
  }
}

function seniorityIcon(s: PersonaTemplate['seniority']): string {
  return s === 'senior' ? 'verified' : 'person';
}

// Silence unused import warning — isDestructive may be used for tool descriptions later.
void isDestructive;