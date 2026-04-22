import * as vscode from 'vscode';
import { AgentDef, TeamDef } from '@ujima/shared';
import type { SessionController, TrackedAgent } from './session-controller';

const DEMO_AGENT_FILES = [
  'senior-designer.json',
  'junior-designer.json',
  'db-analyst.json',
  'senior-engineer.json',
  'junior-engineer.json',
  'senior-qa.json',
  'junior-qa.json',
];

export interface DemoCommandOptions {
  extensionUri: vscode.Uri;
  channel: vscode.OutputChannel;
  controller: SessionController;
}

export async function loadDemoScenarioCommand(options: DemoCommandOptions): Promise<void> {
  const { extensionUri, channel, controller } = options;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage('Ujima: open a workspace folder first — the demo writes into it.');
    return;
  }

  const source = resolveDemoAssetsRoot(extensionUri);
  try {
    await vscode.workspace.fs.stat(source);
  } catch {
    void vscode.window.showErrorMessage(
      `Ujima: demo assets not found at ${source.fsPath}. Run from a source checkout.`,
    );
    return;
  }

  const targetAgents = vscode.Uri.joinPath(folder.uri, '.ujima', 'agents');
  const targetTeams = vscode.Uri.joinPath(folder.uri, '.ujima', 'teams');
  const targetOutput = vscode.Uri.joinPath(folder.uri, 'output');
  const targetSql = vscode.Uri.joinPath(folder.uri, 'users.sql');

  if (await fileExists(targetSql)) {
    const overwrite = await vscode.window.showWarningMessage(
      'Ujima demo: workspace already has users.sql and/or .ujima/. Overwrite?',
      { modal: true },
      'Overwrite',
    );
    if (overwrite !== 'Overwrite') return;
  }

  await vscode.workspace.fs.createDirectory(targetAgents);
  await vscode.workspace.fs.createDirectory(targetTeams);
  await vscode.workspace.fs.createDirectory(targetOutput);

  const registered: TrackedAgent[] = [];
  for (const filename of DEMO_AGENT_FILES) {
    const src = vscode.Uri.joinPath(source, 'agents', filename);
    let parsed: ReturnType<typeof AgentDef.safeParse>;
    try {
      const raw = await vscode.workspace.fs.readFile(src);
      parsed = AgentDef.safeParse(JSON.parse(new TextDecoder().decode(raw)));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      channel.appendLine(`[demo] SKIPPED ${filename} — read/parse failed: ${reason}`);
      continue;
    }
    if (!parsed.success) {
      channel.appendLine(`[demo] SKIPPED ${filename} — invalid schema: ${parsed.error.issues[0]?.message}`);
      continue;
    }
    const target = vscode.Uri.joinPath(targetAgents, `${parsed.data.id}.json`);
    await vscode.workspace.fs.writeFile(
      target,
      new TextEncoder().encode(JSON.stringify(parsed.data, null, 2)),
    );
    const tracked: TrackedAgent = {
      id: parsed.data.id,
      name: parsed.data.name,
      mcp: parsed.data.mcp,
      status: 'idle',
      lastAction: 'loaded from demo scenario',
      tokensUsed: 0,
      tokenCap: parsed.data.permissions.rate_limit.max_session_tokens,
      permissions: parsed.data.permissions,
    };
    controller.upsertAgent(tracked);
    registered.push(tracked);
    channel.appendLine(`[demo] registered ${parsed.data.id} (${parsed.data.mcp})`);
  }

  const teamSrc = vscode.Uri.joinPath(source, 'teams', 'demo-team.json');
  let teamParsed: ReturnType<typeof TeamDef.safeParse> | undefined;
  try {
    const teamRaw = await vscode.workspace.fs.readFile(teamSrc);
    teamParsed = TeamDef.safeParse(JSON.parse(new TextDecoder().decode(teamRaw)));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    channel.appendLine(`[demo] SKIPPED team file — read/parse failed: ${reason}`);
  }
  if (teamParsed?.success) {
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(targetTeams, 'demo-team.json'),
      new TextEncoder().encode(JSON.stringify(teamParsed.data, null, 2)),
    );
    channel.appendLine(`[demo] registered team "${teamParsed.data.team_id}" — ${teamParsed.data.agents.length} agents`);
  } else if (teamParsed) {
    channel.appendLine(`[demo] SKIPPED team file — invalid schema: ${teamParsed.error.issues[0]?.message}`);
  }

  const sqlSrc = vscode.Uri.joinPath(source, 'users.sql');
  const sqlRaw = await vscode.workspace.fs.readFile(sqlSrc);
  await vscode.workspace.fs.writeFile(targetSql, sqlRaw);
  channel.appendLine(`[demo] wrote ${targetSql.fsPath}`);

  channel.appendLine(`[demo] scenario loaded: ${registered.length} agents, output dir: ${targetOutput.fsPath}`);
  channel.show(true);

  const hints: string[] = [];
  if (!(await fileExists(vscode.Uri.joinPath(folder.uri, 'users.db')))) {
    hints.push('Seed users.db: `sqlite3 users.db < users.sql`');
  }
  if (!process.env.FIGMA_API_KEY) {
    hints.push('Export FIGMA_API_KEY before launching VS Code (or kill the two designer agents).');
  }
  const lmReady = await probeVscodeLm();
  if (!lmReady && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    hints.push(
      'Install GitHub Copilot (zero-config via vscode.lm) or set ANTHROPIC_API_KEY / OPENAI_API_KEY. Otherwise agents use the mock provider.',
    );
  }
  if (hints.length > 0) {
    channel.appendLine(`[demo] next steps:`);
    for (const h of hints) channel.appendLine(`  - ${h}`);
  }

  const open = await vscode.window.showInformationMessage(
    `Ujima: demo scenario loaded (${registered.length} agents)${hints.length > 0 ? ' — see output channel for next steps.' : ' — ready to run.'}`,
    'Open Governance',
    'Open Activity Stream',
    'Show runbook',
  );
  if (open === 'Show runbook') {
    const runbook = vscode.Uri.joinPath(source, 'RUNBOOK.md');
    const doc = await vscode.workspace.openTextDocument(runbook);
    await vscode.window.showTextDocument(doc);
  } else if (open === 'Open Governance') {
    await vscode.commands.executeCommand('ujima.openGovernance');
  } else if (open === 'Open Activity Stream') {
    await vscode.commands.executeCommand('ujima.openActivityStream');
  }
}

export interface ValidateCheck {
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail?: string;
}

export async function validateDemoEnvCommand(options: DemoCommandOptions): Promise<void> {
  const { extensionUri, channel } = options;
  const checks = await runDemoEnvChecks(extensionUri);

  channel.appendLine('');
  channel.appendLine('[demo] environment check');
  channel.appendLine('--------------------------------');
  for (const c of checks) {
    const mark = c.status === 'ok' ? '✓' : c.status === 'warn' ? '⚠' : '✗';
    channel.appendLine(`  ${mark} ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
  }
  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  channel.appendLine(`--------------------------------`);
  channel.appendLine(`  ${checks.length - failed - warned} ok · ${warned} warn · ${failed} fail`);
  channel.show(true);

  if (failed > 0) {
    void vscode.window.showWarningMessage(
      `Ujima: demo env has ${failed} failing check${failed === 1 ? '' : 's'} — see the Ujima output channel.`,
    );
  } else if (warned > 0) {
    void vscode.window.showInformationMessage(
      `Ujima: demo env ready (${warned} warning${warned === 1 ? '' : 's'}) — see the Ujima output channel.`,
    );
  } else {
    void vscode.window.showInformationMessage('Ujima: demo environment looks healthy.');
  }
}

export async function runDemoEnvChecks(extensionUri: vscode.Uri): Promise<ValidateCheck[]> {
  const checks: ValidateCheck[] = [];
  const folder = vscode.workspace.workspaceFolders?.[0];

  checks.push(await checkOnPath('npx', 'required for filesystem + figma + playwright MCPs'));
  checks.push(await checkOnPath('uvx', 'required for mcp-server-sqlite (install uv: brew install uv)'));
  checks.push(await checkOnPath('sqlite3', 'required to seed users.db from users.sql (install via your package manager)'));

  if (process.env.FIGMA_API_KEY) {
    checks.push({ label: 'FIGMA_API_KEY env var is set', status: 'ok' });
  } else {
    checks.push({
      label: 'FIGMA_API_KEY env var',
      status: 'warn',
      detail: 'not set — Figma agents will fail to spawn. Export before launching VS Code.',
    });
  }

  const source = resolveDemoAssetsRoot(extensionUri);
  try {
    await vscode.workspace.fs.stat(source);
    checks.push({ label: `demo assets at ${source.fsPath}`, status: 'ok' });
  } catch {
    checks.push({
      label: `demo assets at ${source.fsPath}`,
      status: 'fail',
      detail: 'not found — extension was installed without the examples/demo folder.',
    });
  }

  if (!folder) {
    checks.push({ label: 'workspace folder', status: 'fail', detail: 'no folder open — open one before running the demo.' });
    return checks;
  }
  checks.push({ label: `workspace folder: ${folder.uri.fsPath}`, status: 'ok' });

  const targets = [
    { rel: '.ujima/agents', label: 'workspace/.ujima/agents' },
    { rel: '.ujima/teams', label: 'workspace/.ujima/teams' },
    { rel: 'output', label: 'workspace/output' },
    { rel: 'users.sql', label: 'workspace/users.sql' },
  ];
  for (const t of targets) {
    const uri = vscode.Uri.joinPath(folder.uri, t.rel);
    const exists = await fileExists(uri);
    checks.push({
      label: t.label,
      status: exists ? 'ok' : 'warn',
      detail: exists ? undefined : 'missing — run "Ujima: Load demo scenario" first.',
    });
  }

  const dbUri = vscode.Uri.joinPath(folder.uri, 'users.db');
  const dbExists = await fileExists(dbUri);
  checks.push({
    label: 'workspace/users.db',
    status: dbExists ? 'ok' : 'warn',
    detail: dbExists
      ? undefined
      : 'not seeded — run: sqlite3 users.db < users.sql (from the workspace folder)',
  });

  const vscodeLmAvailable = !!vscode.lm && typeof vscode.lm.selectChatModels === 'function';
  let vscodeLmModels = 0;
  if (vscodeLmAvailable) {
    try {
      const models = await vscode.lm.selectChatModels({});
      vscodeLmModels = models.length;
    } catch {
      vscodeLmModels = 0;
    }
  }
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY || !!process.env.OPENAI_API_KEY;
  if (vscodeLmModels > 0) {
    checks.push({
      label: 'LLM provider',
      status: 'ok',
      detail: `vscode.lm: ${vscodeLmModels} chat model${vscodeLmModels === 1 ? '' : 's'} available (zero-config)`,
    });
  } else if (vscodeLmAvailable && hasApiKey) {
    checks.push({
      label: 'LLM provider',
      status: 'ok',
      detail: `vscode.lm has no models yet (install Copilot) — falling back to ${process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'}`,
    });
  } else if (vscodeLmAvailable) {
    checks.push({
      label: 'LLM provider',
      status: 'warn',
      detail:
        'vscode.lm present but no models (install GitHub Copilot and sign in, or set ANTHROPIC_API_KEY / OPENAI_API_KEY). Agents will use mock until then.',
    });
  } else if (hasApiKey) {
    checks.push({
      label: 'LLM provider',
      status: 'ok',
      detail: process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY set' : 'OPENAI_API_KEY set',
    });
  } else {
    checks.push({
      label: 'LLM provider',
      status: 'warn',
      detail:
        'no vscode.lm and no API key — agents will fall back to the mock provider. Install Copilot or set ANTHROPIC_API_KEY / OPENAI_API_KEY.',
    });
  }

  return checks;
}

function resolveDemoAssetsRoot(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'examples', 'demo');
}

async function probeVscodeLm(): Promise<boolean> {
  if (!vscode.lm || typeof vscode.lm.selectChatModels !== 'function') return false;
  try {
    const models = await vscode.lm.selectChatModels({});
    return models.length > 0;
  } catch {
    return false;
  }
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function checkOnPath(bin: string, hint: string): Promise<ValidateCheck> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [bin]);
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', () => resolve({ label: `${bin} on PATH`, status: 'fail', detail: hint }));
    child.on('close', (code) => {
      if (code === 0 && out.trim()) {
        resolve({ label: `${bin} on PATH`, status: 'ok', detail: out.trim().split('\n')[0] });
      } else {
        resolve({ label: `${bin} on PATH`, status: 'fail', detail: hint });
      }
    });
  });
}
