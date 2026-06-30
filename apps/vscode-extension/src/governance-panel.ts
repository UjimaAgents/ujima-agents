import * as vscode from 'vscode';
import {
  auditToCsv,
  auditToJson,
  buildToolCatalog,
  clearAgent,
  emptyGovernancePolicy,
  removeAgentRule,
  removePlatformRule,
  setAgentRule,
  setPlatformRule,
  type AgentPermissions,
  type GovernancePolicy,
  type HostToWebviewMessage,
  type ToolCatalogEntry,
  type ToolCatalogInput,
  type ToolPolicyRule,
  type WebviewToHostMessage,
} from '@ujima/shared';
import { findRegistryEntry } from '@ujima/mcp-client';
import type { WorkspacePolicyStore } from '@ujima/permissions';
import type { SessionController, TrackedAgent } from './session-controller';
import type { GateCenter } from './gate-center';
import { renderWebviewHtml, resolveWebviewDist, webviewFallbackHtml } from './webview-host';

export interface GovernancePanelOptions {
  extensionUri: vscode.Uri;
  channel: vscode.OutputChannel;
  controller: SessionController;
  onUpdatePermissionsToDef?: (agentId: string, permissions: AgentPermissions) => Promise<void>;
  onKillAgent?: (agentId: string) => void;
  onKillSession?: () => void;
  getPolicyStore?: () => Promise<WorkspacePolicyStore | undefined> | WorkspacePolicyStore | undefined;
  getToolCatalog?: () => Promise<ToolCatalogEntry[]> | ToolCatalogEntry[];
  gateCenter?: GateCenter;
}

export class GovernancePanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private webviewReady = false;
  private readonly opts: GovernancePanelOptions;
  private readonly disposables: vscode.Disposable[] = [];
  private policyUnsubscribe: (() => void) | undefined;

  constructor(opts: GovernancePanelOptions) {
    this.opts = opts;
  }

  reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const webviewDist = resolveWebviewDist(this.opts.extensionUri);
    this.panel = vscode.window.createWebviewPanel(
      'ujima.governance',
      'Ujima — Governance',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewDist],
      },
    );

    try {
      this.panel.webview.html = renderWebviewHtml({
        webview: this.panel.webview,
        webviewDist,
        globals: { __UJIMA_VIEW__: 'governance' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.html = webviewFallbackHtml(message);
      this.opts.channel.appendLine(`[governance] webview render failed: ${message}`);
    }

    const { controller } = this.opts;
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((raw: unknown) => this.handleWebviewMessage(raw)),
      controller.onDidChangeAgents(() => this.postSnapshot()),
      controller.onDidChangeTasks(() => this.postSnapshot()),
      controller.onDidAppendAudit((records) =>
        this.post({ type: 'audit.appended', payload: { records } }),
      ),
      controller.onDidUpdateRate(({ agentId, samples }) =>
        this.post({ type: 'rate.updated', payload: { agentId, samples } }),
      ),
      controller.onDidChangeSessions(() =>
        this.post({ type: 'sessions.updated', payload: { sessions: controller.listSessions() } }),
      ),
      ...(this.opts.gateCenter
        ? [
            this.opts.gateCenter.onGateAdded((gate) =>
              this.post({ type: 'governance.gates.added', payload: { gate } }),
            ),
            this.opts.gateCenter.onGateResolved(({ id, outcome, reason, decidedBy }) =>
              this.post({
                type: 'governance.gates.resolved',
                payload: { id, outcome, reason, decided_by: decidedBy },
              }),
            ),
          ]
        : []),
      this.panel.onDidDispose(() => {
        this.webviewReady = false;
        this.panel = undefined;
        this.policyUnsubscribe?.();
        this.policyUnsubscribe = undefined;
        for (const d of this.disposables.splice(0)) d.dispose();
      }),
    );
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private handleWebviewMessage(raw: unknown): void {
    const msg = raw as WebviewToHostMessage;
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'ready':
        this.webviewReady = true;
        this.postSnapshot();
        void this.postPolicySnapshot();
        void this.subscribePolicyUpdates();
        this.postGatesSnapshot();
        return;
      case 'agent.kill':
        this.opts.onKillAgent?.(msg.payload.agent_id);
        this.opts.controller.killAgent(msg.payload.agent_id);
        return;
      case 'session.kill':
        this.opts.onKillSession?.();
        this.opts.controller.killSession();
        return;
      case 'governance.agent.updatePermissions':
        void this.applyPermissionUpdate(msg.payload.agent_id, msg.payload.permissions, msg.payload.scope);
        return;
      case 'governance.audit.export':
        void this.exportAudit(msg.payload.format);
        return;
      case 'governance.session.load':
        this.opts.channel.appendLine(`[governance] session load requested: ${msg.payload.session_id}`);
        return;
      case 'governance.policy.update':
        void this.applyPolicyUpdate(msg.payload);
        return;
      case 'governance.policy.refresh':
        void this.postPolicySnapshot();
        return;
      case 'governance.gate.decide':
        this.handleGateDecision(msg.payload);
        return;
      default:
        return;
    }
  }

  private handleGateDecision(
    payload: Extract<WebviewToHostMessage, { type: 'governance.gate.decide' }>['payload'],
  ): void {
    if (!this.opts.gateCenter) {
      void vscode.window.showWarningMessage('Ujima: no gate center wired — decision ignored.');
      return;
    }
    const ok = this.opts.gateCenter.decide({
      id: payload.id,
      outcome: payload.outcome,
      args: payload.outcome === 'approve' ? payload.args : undefined,
      reason: payload.reason,
      decidedBy: 'governance-panel',
    });
    if (!ok) {
      this.opts.channel.appendLine(
        `[governance] gate decide: no pending gate with id=${payload.id}`,
      );
    }
  }

  private postGatesSnapshot(): void {
    if (!this.webviewReady || !this.opts.gateCenter) return;
    void this.post({
      type: 'governance.gates.snapshot',
      payload: { pending: this.opts.gateCenter.list() },
    });
  }

  private async applyPermissionUpdate(
    agentId: string,
    permissions: AgentPermissions,
    scope: 'session' | 'def',
  ): Promise<void> {
    const ok = this.opts.controller.updateAgentPermissions(agentId, permissions);
    if (!ok) {
      void vscode.window.showWarningMessage(`Ujima: agent ${agentId} not found — permissions unchanged.`);
      return;
    }
    if (scope === 'def') {
      if (!this.opts.onUpdatePermissionsToDef) {
        this.opts.channel.appendLine(`[governance] def-scope write skipped (no handler): ${agentId}`);
        return;
      }
      try {
        await this.opts.onUpdatePermissionsToDef(agentId, permissions);
        void vscode.window.showInformationMessage(`Ujima: saved permissions for ${agentId} to .ujima/agents/.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Ujima: failed to persist ${agentId} permissions — ${message}`);
      }
    }
  }

  private async exportAudit(format: 'json' | 'csv'): Promise<void> {
    const records = this.opts.controller.listAudit();
    const contents = format === 'csv' ? auditToCsv(records) : auditToJson(records);
    const defaultName = `ujima-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`;
    const folder = vscode.workspace.workspaceFolders?.[0];
    const defaultUri = folder ? vscode.Uri.joinPath(folder.uri, defaultName) : undefined;
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: format === 'csv' ? { CSV: ['csv'] } : { JSON: ['json'] },
      title: 'Ujima — Export audit log',
    });
    if (!target) return;
    try {
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(contents));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.channel.appendLine(`[governance] audit export FAILED → ${target.fsPath}: ${message}`);
      void vscode.window.showErrorMessage(`Ujima: failed to export audit log — ${message}`);
      return;
    }
    this.opts.channel.appendLine(`[governance] audit exported → ${target.fsPath} (${records.length} records)`);
    await this.post({ type: 'audit.export.ready', payload: { format, path: target.fsPath } });
    void vscode.window.showInformationMessage(`Ujima: exported ${records.length} audit records to ${target.fsPath}.`);
  }

  private async applyPolicyUpdate(
    op: Extract<WebviewToHostMessage, { type: 'governance.policy.update' }>['payload'],
  ): Promise<void> {
    const store = await this.resolvePolicyStore();
    if (!store) {
      void vscode.window.showWarningMessage(
        'Ujima: no workspace folder open — governance policy cannot be persisted.',
      );
      return;
    }
    try {
      await store.mutate((current) => this.reducePolicy(current, op));
      this.opts.channel.appendLine(`[governance] policy updated: op=${op.op}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.channel.appendLine(`[governance] policy update FAILED (op=${op.op}): ${message}`);
      void vscode.window.showErrorMessage(`Ujima: failed to save governance policy — ${message}`);
      return;
    }
    await this.postPolicySnapshot();
  }

  private reducePolicy(
    current: GovernancePolicy,
    op: Extract<WebviewToHostMessage, { type: 'governance.policy.update' }>['payload'],
  ): GovernancePolicy {
    switch (op.op) {
      case 'setAgent':
        return setAgentRule(current, op.agent_id, this.stampRule(op.rule));
      case 'removeAgent':
        return removeAgentRule(current, op.agent_id, op.mcp_id, op.tool_name);
      case 'clearAgent':
        return clearAgent(current, op.agent_id);
      case 'setPlatform':
        return setPlatformRule(current, op.bucket, this.stampRule(op.rule));
      case 'removePlatform':
        return removePlatformRule(current, op.bucket, op.mcp_id, op.tool_name);
      case 'quickRevoke':
        return setAgentRule(
          clearAgent(current, op.agent_id),
          op.agent_id,
          this.stampRule({
            mcp_id: '*',
            tool_name: '*',
            state: 'deny',
            reason: 'Revoked via governance panel',
          }),
        );
      default:
        return current;
    }
  }

  private stampRule(rule: ToolPolicyRule): ToolPolicyRule {
    return {
      ...rule,
      updated_at: rule.updated_at ?? new Date().toISOString(),
      updated_by: rule.updated_by ?? 'governance-panel',
    };
  }

  private async subscribePolicyUpdates(): Promise<void> {
    if (this.policyUnsubscribe) return;
    const store = await this.resolvePolicyStore();
    if (!store) return;
    this.policyUnsubscribe = store.onChange(() => {
      void this.postPolicySnapshot();
    });
  }

  private async resolvePolicyStore(): Promise<WorkspacePolicyStore | undefined> {
    if (!this.opts.getPolicyStore) return undefined;
    return this.opts.getPolicyStore();
  }

  private async postPolicySnapshot(): Promise<void> {
    if (!this.webviewReady) return;
    const store = await this.resolvePolicyStore();
    const policy = store?.current() ?? emptyGovernancePolicy();
    const catalog = await this.resolveCatalog(policy);
    await this.post({
      type: 'governance.policy.snapshot',
      payload: { policy, catalog },
    });
  }

  private async resolveCatalog(policy: GovernancePolicy): Promise<ToolCatalogEntry[]> {
    let base: ToolCatalogEntry[] = [];
    if (this.opts.getToolCatalog) {
      try {
        base = await this.opts.getToolCatalog();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.opts.channel.appendLine(`[governance] tool catalog fetch failed: ${message}`);
      }
    }
    return mergeCatalogWithPolicy({
      base,
      policy,
      agents: this.opts.controller.listAgents(),
    });
  }

  private postSnapshot(): void {
    if (!this.webviewReady) return;
    const { controller } = this.opts;
    const agents: TrackedAgent[] = controller.listAgents();
    void this.post({
      type: 'governance.snapshot',
      payload: {
        session_id: controller.sessionId,
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          mcp: a.mcp,
          status: a.status,
          lastAction: a.lastAction,
          tokensUsed: a.tokensUsed,
          tokenCap: a.tokenCap,
          permissions: a.permissions,
        })),
        audit: controller.listAudit(),
        rate: controller.listRate(),
        sessions: controller.listSessions(),
      },
    });
    void this.postPolicySnapshot();
  }

  private async post(msg: HostToWebviewMessage): Promise<void> {
    if (!this.panel) return;
    await this.panel.webview.postMessage(msg);
  }
}

/**
 * Merges a live-discovered tool catalog with the set of tools referenced by the
 * current policy so rules for tools that haven't been probed (MCP not yet
 * spawned) still show up in the matrix.
 */
function mergeCatalogWithPolicy(input: {
  base: ToolCatalogEntry[];
  policy: GovernancePolicy;
  agents: TrackedAgent[];
}): ToolCatalogEntry[] {
  const byKey = new Map<string, ToolCatalogEntry>();
  const keyOf = (mcpId: string, tool: string): string => `${mcpId}::${tool}`;

  for (const entry of input.base) {
    byKey.set(keyOf(entry.mcp_id, entry.tool_name), entry);
  }

  const registryInput: ToolCatalogInput = {
    agents: input.agents.map((a) => ({ id: a.id, mcp: a.mcp })),
    mcps: [],
  };
  const mcpNames = new Map<string, string>();
  for (const a of input.agents) {
    if (!mcpNames.has(a.mcp)) {
      const reg = findRegistryEntry(a.mcp);
      mcpNames.set(a.mcp, reg?.name ?? a.mcp);
    }
  }

  const addSynthetic = (mcpId: string, toolName: string, destructive: boolean): void => {
    if (toolName === '*' || toolName.endsWith('*')) return;
    const key = keyOf(mcpId, toolName);
    if (byKey.has(key)) return;
    const users = input.agents.filter((a) => a.mcp === mcpId).map((a) => a.id);
    const name = mcpNames.get(mcpId) ?? findRegistryEntry(mcpId)?.name ?? mcpId;
    byKey.set(key, {
      mcp_id: mcpId,
      mcp_name: name,
      tool_name: toolName,
      destructive,
      agents: users,
    });
  };

  for (const mcpId of mcpNames.keys()) {
    const reg = findRegistryEntry(mcpId);
    for (const t of reg?.knownDestructiveTools ?? []) addSynthetic(mcpId, t, true);
  }

  for (const rule of input.policy.platform.always_deny) addSynthetic(rule.mcp_id, rule.tool_name, true);
  for (const rule of input.policy.platform.always_allow)
    addSynthetic(rule.mcp_id, rule.tool_name, false);
  for (const rule of input.policy.platform.default_require_approval)
    addSynthetic(rule.mcp_id, rule.tool_name, false);
  for (const rules of Object.values(input.policy.agents)) {
    for (const rule of rules) {
      const reg = findRegistryEntry(rule.mcp_id);
      const destructive = reg?.knownDestructiveTools?.includes(rule.tool_name) ?? false;
      addSynthetic(rule.mcp_id, rule.tool_name, destructive);
    }
  }

  // Use buildToolCatalog only if we have no base + no synthetic entries so
  // unused mcps still appear; otherwise rely on the merged map.
  if (byKey.size === 0) {
    const merged = buildToolCatalog({ ...registryInput, mcps: [] });
    return merged;
  }

  return [...byKey.values()].sort((a, b) =>
    a.mcp_id === b.mcp_id
      ? a.tool_name.localeCompare(b.tool_name)
      : a.mcp_id.localeCompare(b.mcp_id),
  );
}
