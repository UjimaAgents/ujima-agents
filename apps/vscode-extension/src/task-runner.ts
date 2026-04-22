import * as vscode from 'vscode';
import {
  AgentDef,
  TeamDef,
  buildToolCatalog,
  type MCPDef,
  type TaskDef,
  type ToolCatalogEntry,
} from '@ujima/shared';
import type { UjimaDb } from '@ujima/context-store';
import type { EventBus } from '@ujima/event-bus';
import type { PermissionMiddleware } from '@ujima/permissions';
import { bindGovernancePolicyStore, type GovernancePolicyBinding } from './governance-policy-store';
import { findRegistryEntry, type MCPPool } from '@ujima/mcp-client';
import { createRuntimeHost, type RuntimeHost } from '@ujima/runtime-core';
import { createVscodeOutputChannelLogger } from './runtime-logger-adapter';
import {
  createMockProvider,
  selectProvider,
  textTurn,
  type LLMProvider,
} from '@ujima/llm';
import { runTask, type SessionHandle } from '@ujima/orchestrator';
import type { SessionController } from './session-controller';
import { createVscodeLmProvider } from './vscode-lm-provider';
import type { AgentChatPanel } from './agent-chat-panel';
import type { GateCenter } from './gate-center';

export interface TaskRunnerOptions {
  storageDir: vscode.Uri;
  channel: vscode.OutputChannel;
  controller: SessionController;
  chatPanel?: AgentChatPanel;
  gateCenter?: GateCenter;
}

export interface ActiveRun {
  taskId: string;
  handle: SessionHandle;
  startedAt: number;
}

interface Infra {
  host: RuntimeHost;
  db: UjimaDb;
  bus: EventBus;
  permissions: PermissionMiddleware;
  pool: MCPPool;
  policy?: GovernancePolicyBinding;
}

export class TaskRunner implements vscode.Disposable {
  private infra: Infra | undefined;
  private readonly active = new Map<string, ActiveRun>();

  constructor(private readonly opts: TaskRunnerOptions) {}

  /**
   * Ensures infra is initialised and returns the workspace governance policy
   * binding. Returns `undefined` when there is no open workspace folder.
   */
  async getPolicyStore(): Promise<GovernancePolicyBinding | undefined> {
    const { policy } = await this.ensureInfra();
    return policy;
  }

  /**
   * Builds a tool catalog for the governance IAM matrix. Uses agent defs on
   * disk (so the matrix reflects all onboarded agents, not just currently
   * running ones) joined with any MCPs that are already connected via the
   * pool — avoids spawning MCPs just to populate the grid.
   */
  async getToolCatalog(): Promise<ToolCatalogEntry[]> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return [];
    const infra = this.infra;
    const pool = infra?.pool;
    const agents = await this.loadAllAgents(folder.uri);
    if (agents.length === 0) return [];

    const uniqueMcps = [...new Set(agents.map((a) => a.mcp))];
    const mcps: ToolCatalogEntry[] = [];
    for (const mcpId of uniqueMcps) {
      const reg = findRegistryEntry(mcpId);
      let tools: { name: string; description?: string }[] = [];
      if (pool?.has(mcpId)) {
        try {
          const def = await this.resolveMCPDef(folder.uri, mcpId);
          const conn = await pool.get(def);
          const discovered = await conn.listTools();
          tools = discovered.map((t) => ({ name: t.name, description: t.description }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.opts.channel.appendLine(`[runner] catalog listTools(${mcpId}) failed: ${msg}`);
        }
      }
      mcps.push(
        ...buildToolCatalog({
          agents: agents.map((a) => ({ id: a.id, mcp: a.mcp })),
          mcps: [
            {
              id: mcpId,
              name: reg?.name ?? mcpId,
              tools,
              destructiveTools: reg?.knownDestructiveTools ?? [],
            },
          ],
        }),
      );
    }
    return mcps;
  }

  private async loadAllAgents(workspace: vscode.Uri): Promise<AgentDef[]> {
    const dir = vscode.Uri.joinPath(workspace, '.ujima', 'agents');
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return [];
    }
    const out: AgentDef[] = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith('.json')) continue;
      try {
        const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, name));
        const parsed = AgentDef.safeParse(JSON.parse(new TextDecoder().decode(raw)));
        if (parsed.success) out.push(parsed.data);
      } catch {
        // ignore — one bad file shouldn't blank the matrix
      }
    }
    return out;
  }

  async startFromWorkspace(prompt: string, opts?: { mode?: 'auto' | 'manual' }): Promise<'started' | 'no-workspace' | 'no-team' | 'canceled'> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showErrorMessage('Ujima: open a workspace folder first.');
      return 'no-workspace';
    }

    const teams = await this.loadTeams(folder.uri);
    if (teams.length === 0) {
      void vscode.window.showErrorMessage(
        'Ujima: no teams found in .ujima/teams/. Run "Ujima: Load demo scenario" first, or define a team.',
      );
      return 'no-team';
    }

    let team = teams[0];
    if (teams.length > 1) {
      const pick = await vscode.window.showQuickPick(
        teams.map((t) => ({ label: t.name, description: t.team_id, detail: `${t.agents.length} agents`, value: t })),
        { title: 'Ujima — Pick a team for this task', ignoreFocusOut: true },
      );
      if (!pick) return 'canceled';
      team = pick.value;
    }
    if (!team) return 'canceled';

    const agents = await this.loadAgents(folder.uri, team.agents);
    const missing = team.agents.filter((id) => !agents.some((a) => a.id === id));
    if (missing.length > 0) {
      void vscode.window.showErrorMessage(
        `Ujima: team "${team.team_id}" references agents missing from .ujima/agents/: ${missing.join(', ')}`,
      );
      return 'canceled';
    }

    const { db, bus, permissions, pool } = await this.ensureInfra();

    const mode = opts?.mode ?? await pickOrchestratorMode(team.agents.length);
    if (!mode) return 'canceled';

    const task: TaskDef = {
      task_id: `task_${Date.now().toString(36)}`,
      prompt,
      team_id: team.team_id,
      orchestrator_mode: mode,
      execution_mode: 'concurrent',
    };

    const preflightErrors = await this.preflightMCPs(folder.uri, agents, pool);
    if (preflightErrors.length > 0) {
      const summary = preflightErrors.map((e) => `• ${e.agentId} → ${e.mcpId}: ${e.error}`).join('\n');
      this.opts.channel.appendLine(`[task] preflight failed before ${task.task_id}:\n${summary}`);
      this.opts.channel.show(true);
      void vscode.window.showErrorMessage(
        `Ujima: task aborted — ${preflightErrors.length} MCP${preflightErrors.length === 1 ? '' : 's'} failed to spawn. See Output → Ujima for details.`,
      );
      return 'canceled';
    }

    this.opts.channel.appendLine(
      `[task] starting ${task.task_id} team=${team.team_id} agents=${team.agents.join(',')}`,
    );

    const chat = this.opts.chatPanel;
    if (chat) {
      chat.reveal();
      chat.onTaskStarted(task.task_id, prompt, agents.map((a) => a.id));
    }

    const agentById = new Map(agents.map((a) => [a.id, a]));
    const handle = runTask(
      {
        resolveAgent: (id) => agentById.get(id),
        getMCPConnection: async (mcpId, opts) => {
          const agent = agents.find((a) => a.mcp === mcpId);
          if (!agent) throw new Error(`no agent uses MCP "${mcpId}"`);
          const def = await this.resolveMCPDef(folder.uri, mcpId);
          return pool.get(def, opts);
        },
        getProvider: () => this.pickProvider(),
        eventBus: bus,
        context: db.context,
        audit: db.audit,
        permissions,
        agentState: db.agentState,
        approvals: db.approvals,
        taskState: db.taskState,
        onStream: chat ? (ev) => chat.onStreamEvent(ev) : undefined,
        gateResolver: this.opts.gateCenter?.resolver(),
      },
      { task, team, sessionId: this.opts.controller.sessionId },
    );

    this.active.set(task.task_id, { taskId: task.task_id, handle, startedAt: Date.now() });
    this.opts.controller.registerTask({
      taskId: task.task_id,
      prompt,
      mode: 'manual',
      execution: 'concurrent',
      status: 'running',
      startedAt: Date.now(),
    });

    for (const agent of agents) {
      this.opts.controller.upsertAgent({
        id: agent.id,
        name: agent.name,
        mcp: agent.mcp,
        status: 'active',
        lastAction: `task ${task.task_id}`,
        tokensUsed: 0,
        tokenCap: agent.permissions.rate_limit.max_session_tokens,
        permissions: agent.permissions,
      });
    }

    void handle.result
      .then((result) => {
        const errors = result.agentResults
          .filter((r) => r.exitReason === 'error' && r.error)
          .map((r) => `${r.agentId}: ${r.error}`);
        const errText = errors.length ? errors.join(' | ') : '-';
        this.opts.channel.appendLine(
          `[task] ${task.task_id} → ${result.status}  approvals=${result.approvalsPending}  error=${errText}`,
        );
        if (chat) {
          chat.onTaskEnded(task.task_id, result.status, errors.length ? errors.join(' | ') : undefined);
        }
        for (const r of result.agentResults) {
          this.opts.channel.appendLine(
            `[task]   ${r.agentId}: ${r.exitReason} · iter=${r.iterations} · tools=${r.toolCalls} · tokens=${r.tokensUsed}${r.error ? ` · err=${r.error}` : ''}`,
          );
        }
        const tasks = this.opts.controller.listTasks();
        const tracked = tasks.find((t) => t.taskId === task.task_id);
        if (tracked) {
          const status =
            result.status === 'completed'
              ? 'complete'
              : result.status === 'paused'
                ? 'paused'
                : 'failed';
          this.opts.controller.registerTask({ ...tracked, status });
        }
        for (const r of result.agentResults) {
          const existing = this.opts.controller.listAgents().find((a) => a.id === r.agentId);
          if (existing) {
            this.opts.controller.upsertAgent({
              ...existing,
              status: r.exitReason === 'completed' ? 'exited' : r.exitReason === 'killed' ? 'killed' : 'exited',
              lastAction: r.error ?? r.exitReason,
              tokensUsed: r.tokensUsed,
            });
          }
        }
        void vscode.window.showInformationMessage(
          `Ujima: task ${task.task_id} → ${result.status}${errors.length ? ` (${errors[0]})` : ''}`,
        );
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.opts.channel.appendLine(`[task] ${task.task_id} CRASHED: ${message}`);
        void vscode.window.showErrorMessage(`Ujima: task ${task.task_id} crashed — ${message}`);
        if (chat) chat.onTaskEnded(task.task_id, 'failed', message);
      })
      .finally(() => {
        this.active.delete(task.task_id);
      });

    return 'started';
  }

  killAgent(agentId: string): boolean {
    let hit = false;
    for (const { handle } of this.active.values()) {
      if (handle.agentIds().includes(agentId)) {
        handle.killAgent(agentId);
        hit = true;
      }
    }
    return hit;
  }

  killAll(): void {
    for (const { handle } of this.active.values()) handle.killSession();
    this.active.clear();
  }

  private async ensureInfra(): Promise<Infra> {
    if (this.infra) return this.infra;
    await vscode.workspace.fs.createDirectory(this.opts.storageDir);
    const homeDir = this.opts.storageDir.fsPath;
    const dbPath = vscode.Uri.joinPath(this.opts.storageDir, 'ujima.db').fsPath;
    const policy = await bindGovernancePolicyStore({ channel: this.opts.channel });
    const logger = createVscodeOutputChannelLogger({ channel: this.opts.channel, baseFields: { component: 'runner' } });
    const host = await createRuntimeHost(
      {
        homeDir,
        logger,
        loadAgent: async () => undefined,
        loadTeam: async () => undefined,
        resolveMCPDef: async (_wsId, mcpId) => {
          throw new Error(`plugin runtime-host has no MCP resolver (requested "${mcpId}")`);
        },
        getProvider: () => this.pickProvider(),
        policyResolver: policy ? () => policy.store.current() : undefined,
      },
      { dbPath },
    );
    this.infra = {
      host,
      db: host.db,
      bus: host.bus,
      permissions: host.permissions,
      pool: host.pool,
      policy,
    };
    this.opts.channel.appendLine(`[runner] initialised (db=${dbPath})`);
    return this.infra;
  }

  private pickProvider(): LLMProvider {
    const vscodeLm = createVscodeLmProvider({ channel: this.opts.channel });
    try {
      const provider = selectProvider({
        order: ['vscode-lm', 'anthropic', 'openai-compat', 'ollama'],
        config: { vscodeLmProvider: vscodeLm },
      });
      this.opts.channel.appendLine(`[runner] LLM provider: ${provider.id}`);
      return provider;
    } catch {
      this.opts.channel.appendLine(
        `[runner] no real LLM provider available — falling back to mock. Install GitHub Copilot (for vscode.lm) or set ANTHROPIC_API_KEY / OPENAI_API_KEY / run Ollama.`,
      );
      return createMockProvider({ script: [textTurn('(mock) no LLM configured — enable Copilot or set an API key to run real agents.')] });
    }
  }

  private async loadTeams(workspace: vscode.Uri): Promise<TeamDef[]> {
    const dir = vscode.Uri.joinPath(workspace, '.ujima', 'teams');
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return [];
    }
    const teams: TeamDef[] = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith('.json')) continue;
      try {
        const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, name));
        const parsed = TeamDef.safeParse(JSON.parse(new TextDecoder().decode(raw)));
        if (parsed.success) teams.push(parsed.data);
        else this.opts.channel.appendLine(`[runner] skipped team ${name}: ${parsed.error.issues[0]?.message}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.opts.channel.appendLine(`[runner] could not read team ${name}: ${msg}`);
      }
    }
    return teams;
  }

  private async loadAgents(workspace: vscode.Uri, ids: string[]): Promise<AgentDef[]> {
    const dir = vscode.Uri.joinPath(workspace, '.ujima', 'agents');
    const out: AgentDef[] = [];
    for (const id of ids) {
      try {
        const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, `${id}.json`));
        const parsed = AgentDef.safeParse(JSON.parse(new TextDecoder().decode(raw)));
        if (parsed.success) out.push(parsed.data);
        else this.opts.channel.appendLine(`[runner] skipped agent ${id}: ${parsed.error.issues[0]?.message}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.opts.channel.appendLine(`[runner] could not read agent ${id}: ${msg}`);
      }
    }
    return out;
  }

  private async preflightMCPs(
    workspace: vscode.Uri,
    agents: AgentDef[],
    pool: MCPPool,
  ): Promise<{ agentId: string; mcpId: string; error: string }[]> {
    const errors: { agentId: string; mcpId: string; error: string }[] = [];
    const tested = new Map<string, string | null>();
    for (const agent of agents) {
      const cached = tested.get(agent.mcp);
      if (cached !== undefined) {
        if (cached) errors.push({ agentId: agent.id, mcpId: agent.mcp, error: cached });
        continue;
      }
      let err: string | null = null;
      try {
        const def = await this.resolveMCPDef(workspace, agent.mcp);
        const conn = await pool.get(def);
        await conn.listTools();
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      tested.set(agent.mcp, err);
      if (err) errors.push({ agentId: agent.id, mcpId: agent.mcp, error: err });
    }
    return errors;
  }

  private async resolveMCPDef(workspace: vscode.Uri, mcpId: string): Promise<MCPDef> {
    const cfg = vscode.workspace.getConfiguration('ujima.mcp');
    const envOverrides = readStringRecord(cfg.get<Record<string, unknown>>('env'));

    const custom = cfg.get<unknown[]>('custom') ?? [];
    const customMatch = custom.find(
      (e): e is Record<string, unknown> => typeof e === 'object' && e !== null && (e as { id?: unknown }).id === mcpId,
    );
    if (customMatch) {
      const { MCPDef } = await import('@ujima/shared');
      const def = MCPDef.parse({ ...customMatch, env: { ...(customMatch.env as object ?? {}), ...envOverrides } });
      return def;
    }

    const { findRegistryEntry, instantiateFromRegistry } = await import('@ujima/mcp-client');
    const entry = findRegistryEntry(mcpId);
    if (!entry) {
      throw new Error(
        `no registry entry for MCP "${mcpId}". Add it via "Ujima: Add MCP Server" or to .ujima/mcp/${mcpId}.json.`,
      );
    }
    const subs: Record<string, string> = {};
    if (mcpId === 'filesystem') {
      const cfgRoot = vscode.workspace.getConfiguration('ujima.mcp').get<string>('filesystemRoot');
      subs.rootDir = cfgRoot || workspace.fsPath;
    }
    if (mcpId === 'sqlite') subs.dbPath = vscode.Uri.joinPath(workspace, 'users.db').fsPath;
    const def = instantiateFromRegistry(mcpId, { argSubstitutions: subs, envOverrides });
    return def;
  }

  dispose(): void {
    this.killAll();
    this.infra?.policy?.dispose();
    void this.infra?.host.shutdown({ drainMs: 2_000 });
  }
}

async function pickOrchestratorMode(teamSize: number): Promise<'auto' | 'manual' | undefined> {
  if (teamSize <= 1) return 'manual';
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: '$(wand) Auto',
        description: 'Planner picks which agents to run and what to tell each one',
        detail: 'Recommended for mixed-capability teams. One extra LLM call up front.',
        value: 'auto' as const,
      },
      {
        label: '$(broadcast) Manual (broadcast)',
        description: 'Send the prompt to every agent in the team',
        detail: 'Use when you specifically want every agent to weigh in.',
        value: 'manual' as const,
      },
    ],
    {
      title: 'Ujima — Orchestrator mode',
      placeHolder: 'How should the task be routed?',
      ignoreFocusOut: true,
    },
  );
  return pick?.value;
}

function readStringRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}
