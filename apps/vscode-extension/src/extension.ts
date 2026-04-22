import * as vscode from 'vscode';
import {
  UJIMA_VERSION,
  AgentDef,
  type ActivityEvent,
  type AgentPermissions,
} from '@ujima/shared';
import { listRegistry, type RegistryEntry } from '@ujima/mcp-client';
import { SessionController, type TrackedAgent, type TrackedTask } from './session-controller';
import { AgentsTreeProvider } from './agents-tree';
import { ActionsTreeProvider } from './actions-tree';
import { TeamsTreeProvider } from './teams-tree';
import { McpsTreeProvider } from './mcps-tree';
import { ActivityStreamPanel } from './activity-stream-panel';
import { GovernancePanel } from './governance-panel';
import { onboardAgentCommand } from './onboard-agent';
import { OnboardWizardPanel } from './onboard-wizard-panel';
import { loadDemoScenarioCommand, validateDemoEnvCommand } from './demo-scenario';
import { TaskRunner } from './task-runner';
import { GateCenter } from './gate-center';
import { openAddMcpPanel } from './add-mcp-panel';
import { AgentChatPanel } from './agent-chat-panel';
import { offboardAgentCommand } from './offboard-agent';
import { createTeamCommand, manageTeamsCommand } from './teams';

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('Ujima');
  channel.appendLine(`Ujima v${UJIMA_VERSION} activated`);

  const controller = new SessionController({ channel, memento: context.globalState });

  const agentsTreeProvider = new AgentsTreeProvider(controller);
  const agentsTreeView = vscode.window.createTreeView('ujima.agents', {
    treeDataProvider: agentsTreeProvider,
    showCollapseAll: true,
  });

  const actionsTreeView = vscode.window.createTreeView('ujima.actions', {
    treeDataProvider: new ActionsTreeProvider(),
  });

  const teamsTreeProvider = new TeamsTreeProvider(channel);
  const teamsTreeView = vscode.window.createTreeView('ujima.teams', {
    treeDataProvider: teamsTreeProvider,
    showCollapseAll: true,
  });

  const mcpsTreeProvider = new McpsTreeProvider();
  const mcpsTreeView = vscode.window.createTreeView('ujima.mcps', {
    treeDataProvider: mcpsTreeProvider,
    showCollapseAll: true,
  });

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = '$(organization) Ujima';
  statusBar.tooltip = 'Ujima — open agents view';
  statusBar.command = 'ujima.openGovernance';
  statusBar.show();

  controller.onDidChangeAgents(() => {
    const agents = controller.listAgents();
    const active = agents.filter((a) => a.status === 'active' || a.status === 'waiting').length;
    statusBar.text = `$(organization) Ujima${active > 0 ? ` — ${active} active` : ''}`;
  });

  const activityPanel = new ActivityStreamPanel({
    extensionUri: context.extensionUri,
    channel,
    onWebviewMessage: (msg) => channel.appendLine(`[activity] webview → ${msg.type}`),
  });
  const chatPanel = new AgentChatPanel({ channel });
  const onboardWizard = new OnboardWizardPanel({ channel, controller });
  const gateCenter = new GateCenter(channel);
  const runner = new TaskRunner({
    storageDir: context.globalStorageUri,
    channel,
    controller,
    chatPanel,
    gateCenter,
  });
  chatPanel.setCallbacks({
    onSubmitTask: (prompt, mode) => {
      runner.startFromWorkspace(prompt, { mode }).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        channel.appendLine(`[chat] task start failed: ${message}`);
        void vscode.window.showErrorMessage(`Ujima: couldn't start task — ${message}`);
      });
    },
    onApprovalDecision: (approvalId, decision, reason) => {
      channel.appendLine(`[chat] approval ${approvalId} → ${decision}${reason ? ` (${reason})` : ''}`);
      chatPanel.onApprovalDecided(approvalId, decision);
    },
    onCancelAgent: (agentId) => {
      const ok = runner.killAgent(agentId);
      channel.appendLine(`[chat] cancel agent ${agentId} → ${ok ? 'killed' : 'not-running'}`);
    },
    onRetryTask: (taskId) => {
      channel.appendLine(`[chat] retry requested for task ${taskId || '(current)'}`);
    },
  });
  const governancePanel = new GovernancePanel({
    extensionUri: context.extensionUri,
    channel,
    controller,
    onUpdatePermissionsToDef: (agentId, permissions) =>
      persistAgentPermissions(agentId, permissions, channel),
    onKillAgent: (id) => runner.killAgent(id),
    onKillSession: () => runner.killAll(),
    getPolicyStore: async () => {
      const binding = await runner.getPolicyStore();
      return binding?.store;
    },
    getToolCatalog: () => runner.getToolCatalog(),
    gateCenter,
  });
  const activityFeed = wireActivityFeed(controller, activityPanel);
  const rateSampler = startRateSampler(controller);

  context.subscriptions.push(
    channel,
    statusBar,
    controller,
    agentsTreeView,
    actionsTreeView,
    teamsTreeView,
    mcpsTreeView,
    teamsTreeProvider,
    mcpsTreeProvider,
    activityFeed,
    rateSampler,
    { dispose: () => activityPanel.dispose() },
    chatPanel,
    onboardWizard,
    governancePanel,
    runner,
    gateCenter,
    vscode.commands.registerCommand('ujima.newTask', () => newTaskCommand(controller, runner, channel)),
    vscode.commands.registerCommand('ujima.openRegistry', () => openRegistryCommand(channel)),
    vscode.commands.registerCommand('ujima.addMcp', () => openAddMcpPanel(channel)),
    vscode.commands.registerCommand('ujima.onboardAgent', () => onboardAgentCommand(channel, controller)),
    vscode.commands.registerCommand('ujima.onboardAgentWizard', () => onboardWizard.reveal()),
    vscode.commands.registerCommand('ujima.offboardAgent', (arg: unknown) =>
      offboardAgentCommand(channel, controller, arg),
    ),
    vscode.commands.registerCommand('ujima.createTeam', () => createTeamCommand(channel)),
    vscode.commands.registerCommand('ujima.manageTeams', () => manageTeamsCommand(channel)),
    vscode.commands.registerCommand('ujima.openGovernance', () => governancePanel.reveal()),
    vscode.commands.registerCommand('ujima.openActivityStream', () => activityPanel.reveal()),
    vscode.commands.registerCommand('ujima.openAgentChat', () => chatPanel.reveal()),
    vscode.commands.registerCommand('ujima.loadDemoScenario', () =>
      loadDemoScenarioCommand({ extensionUri: context.extensionUri, channel, controller }),
    ),
    vscode.commands.registerCommand('ujima.validateDemoEnv', () =>
      validateDemoEnvCommand({ extensionUri: context.extensionUri, channel, controller }),
    ),
    vscode.commands.registerCommand('ujima.killAgent', async (arg: unknown) =>
      killAgentCommand(controller, runner, arg),
    ),
    vscode.commands.registerCommand('ujima.killSession', async () =>
      killSessionCommand(controller, runner),
    ),
  );
}

function startRateSampler(controller: SessionController): vscode.Disposable {
  const lastTokens = new Map<string, number>();
  const interval = setInterval(() => {
    try {
      for (const a of controller.listAgents()) {
        if (a.status !== 'active' && a.status !== 'waiting') continue;
        const prev = lastTokens.get(a.id) ?? a.tokensUsed;
        const delta = Math.max(0, a.tokensUsed - prev);
        lastTokens.set(a.id, a.tokensUsed);
        controller.recordRateSample(a.id, { calls: a.status === 'active' ? 1 : 0, tokens: delta });
      }
    } catch {
      // sampler errors must never leak — if the controller is gone/disposed, just skip this tick
    }
  }, 5_000);
  return { dispose: () => clearInterval(interval) };
}

async function persistAgentPermissions(
  agentId: string,
  permissions: AgentPermissions,
  channel: vscode.OutputChannel,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('Open a workspace folder first.');
  const file = vscode.Uri.joinPath(folder.uri, '.ujima', 'agents', `${agentId}.json`);
  let raw: Uint8Array;
  try {
    raw = await vscode.workspace.fs.readFile(file);
  } catch {
    throw new Error(`.ujima/agents/${agentId}.json not found — onboard the agent first.`);
  }
  const parsed = AgentDef.safeParse(JSON.parse(new TextDecoder().decode(raw)));
  if (!parsed.success) throw new Error(`Invalid agent def: ${parsed.error.issues[0]?.message ?? 'bad JSON'}`);
  const next: typeof parsed.data = { ...parsed.data, permissions };
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(next, null, 2)));
  channel.appendLine(`[governance] persisted permissions → ${file.fsPath}`);
}

function wireActivityFeed(
  controller: SessionController,
  panel: ActivityStreamPanel,
): vscode.Disposable {
  const seenAgents = new Map<string, TrackedAgent>();
  const seenTasks = new Map<string, TrackedTask>();
  let seq = 0;
  const mkId = (): string => `evt_${Date.now().toString(36)}_${(seq++).toString(36)}`;
  const now = (): string => new Date().toISOString();

  const agentsSub = controller.onDidChangeAgents(() => {
    const events: ActivityEvent[] = [];
    const current = new Map(controller.listAgents().map((a) => [a.id, a]));
    for (const [id, a] of current) {
      const prev = seenAgents.get(id);
      if (!prev) {
        events.push({
          event_id: mkId(),
          type: 'agent_registered',
          publisher: id,
          timestamp: now(),
          payload: { name: a.name, mcp: a.mcp, status: a.status },
        });
      } else if (prev.status !== a.status || prev.lastAction !== a.lastAction) {
        events.push({
          event_id: mkId(),
          type: a.status === 'killed' ? 'agent_killed' : 'agent_status_changed',
          publisher: id,
          timestamp: now(),
          payload: { from: prev.status, to: a.status, lastAction: a.lastAction },
        });
      }
      seenAgents.set(id, a);
    }
    for (const id of seenAgents.keys()) {
      if (!current.has(id)) {
        events.push({
          event_id: mkId(),
          type: 'agent_removed',
          publisher: id,
          timestamp: now(),
          payload: {},
        });
        seenAgents.delete(id);
      }
    }
    if (events.length > 0) panel.pushEvents(events);
  });

  const tasksSub = controller.onDidChangeTasks(() => {
    const events: ActivityEvent[] = [];
    const current = new Map(controller.listTasks().map((t) => [t.taskId, t]));
    for (const [id, t] of current) {
      const prev = seenTasks.get(id);
      if (!prev) {
        events.push({
          event_id: mkId(),
          type: 'task_registered',
          publisher: 'orchestrator',
          timestamp: now(),
          task_id: id,
          payload: { prompt: t.prompt, mode: t.mode, execution: t.execution, status: t.status },
        });
      } else if (prev.status !== t.status) {
        events.push({
          event_id: mkId(),
          type: `task_${t.status}`,
          publisher: 'orchestrator',
          timestamp: now(),
          task_id: id,
          payload: { from: prev.status, to: t.status },
        });
      }
      seenTasks.set(id, t);
    }
    if (events.length > 0) panel.pushEvents(events);
  });

  return { dispose: () => {
    agentsSub.dispose();
    tasksSub.dispose();
  } };
}

async function newTaskCommand(
  _controller: SessionController,
  runner: TaskRunner,
  channel: vscode.OutputChannel,
): Promise<void> {
  const prompt = await vscode.window.showInputBox({
    title: 'Ujima — New Task',
    prompt: 'Describe what you want the team to do',
    placeHolder: 'e.g. Design and build a user profile card from the users table…',
    ignoreFocusOut: true,
  });
  if (!prompt) return;

  try {
    const outcome = await runner.startFromWorkspace(prompt);
    if (outcome === 'started') {
      void vscode.window.showInformationMessage('Ujima: task started. Watch the Activity Stream.');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    channel.appendLine(`[task] start failed: ${message}`);
    void vscode.window.showErrorMessage(`Ujima: couldn't start task — ${message}`);
  }
}

async function killAgentCommand(
  controller: SessionController,
  runner: TaskRunner,
  arg: unknown,
): Promise<void> {
  let agentId: string | undefined = extractAgentId(arg);
  if (!agentId) {
    const agents = controller.listAgents();
    if (agents.length === 0) {
      void vscode.window.showInformationMessage('No agents to kill.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      agents.map((a) => ({ label: a.name, description: a.id, detail: `${a.mcp} · ${a.status}`, value: a.id })),
      { title: 'Kill which agent?' },
    );
    agentId = pick?.value;
  }
  if (!agentId) return;
  runner.killAgent(agentId);
  if (controller.killAgent(agentId)) {
    void vscode.window.showInformationMessage(`Ujima: killed agent ${agentId}.`);
  } else {
    void vscode.window.showWarningMessage(`Ujima: agent ${agentId} not found.`);
  }
}

async function openRegistryCommand(channel: vscode.OutputChannel): Promise<void> {
  const entries = listRegistry();
  const pick = await vscode.window.showQuickPick(
    entries.map((e) => ({
      label: `$(${categoryIcon(e.category)}) ${e.name}`,
      description: e.category,
      detail: e.description,
      entry: e,
    })),
    {
      title: 'Ujima — MCP Registry',
      placeHolder: `${entries.length} curated servers. Pick one to view connection details.`,
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!pick) return;
  const detail = describeEntry(pick.entry);
  channel.appendLine(detail);
  channel.show(true);
}

function categoryIcon(category: string): string {
  switch (category) {
    case 'design':
      return 'symbol-color';
    case 'browser':
      return 'browser';
    case 'database':
      return 'database';
    case 'filesystem':
      return 'file-directory';
    default:
      return 'plug';
  }
}

function describeEntry(entry: RegistryEntry): string {
  const lines = [
    `\n[registry] ${entry.name} (${entry.id})`,
    `  category: ${entry.category}`,
    `  ${entry.description}`,
    `  homepage: ${entry.homepage ?? 'n/a'}`,
    `  command: ${entry.defaults.command ?? 'n/a'} ${entry.defaults.args.join(' ')}`,
  ];
  if (entry.requires?.envVars?.length) {
    lines.push(`  requires env: ${entry.requires.envVars.join(', ')}`);
  }
  if (entry.requires?.args?.length) {
    for (const a of entry.requires.args) {
      lines.push(`  requires arg \${${a.key}}: ${a.description}`);
    }
  }
  if (entry.knownDestructiveTools?.length) {
    lines.push(`  destructive tools flagged: ${entry.knownDestructiveTools.join(', ')}`);
  }
  lines.push(`  (install flow ships with Epic 7 onboarding wizard)`);
  return lines.join('\n');
}

async function killSessionCommand(
  controller: SessionController,
  runner: TaskRunner,
): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    'Kill the whole Ujima session? All running agents will stop.',
    { modal: true },
    'Kill session',
  );
  if (confirm !== 'Kill session') return;
  runner.killAll();
  controller.killSession();
  void vscode.window.showInformationMessage('Ujima: session killed.');
}

function extractAgentId(arg: unknown): string | undefined {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object' && 'id' in arg && typeof (arg as { id: unknown }).id === 'string') {
    return (arg as { id: string }).id;
  }
  return undefined;
}

export function deactivate(): void {
  // no-op
}
