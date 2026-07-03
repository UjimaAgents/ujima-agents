import { describe, expect, it } from 'vitest';
import { loadAgentTeam } from '@ujima/framework';
import { ToolServiceImpl } from './tool-service-impl.js';
import { createPermissionGatedToolService, type ToolService } from './tool-service.js';
import { createTeamStore } from './team-store.js';
import { ApprovedRunScopeTracker } from '../utils/approved-run-scopes.js';

describe('createPermissionGatedToolService', () => {
  it('creates an approval for destructive commands and bypasses permission once after allowRun', async () => {
    let innerCalls = 0;
    let approvals = 0;
    let lastApprovalScope = '';

    const inner: ToolService = {
      async invoke() {
        innerCalls++;
        return { ok: true, output: { status: 'completed' } };
      },
      allowRun() {
        return undefined;
      },
    };

    const tools = createPermissionGatedToolService(
      inner,
      {
        async check() {
          return {
            allowed: false,
            reason: 'Input matches a destructive pattern and requires explicit approval',
            code: 'destructive_pattern',
            gate: 'approval',
          };
        },
        async recordUsage() {
          return undefined;
        },
        async recordCompletedCall() {
          return undefined;
        },
        setSessionOverride() {
          return undefined;
        },
        clearSessionOverride() {
          return undefined;
        },
        setGovernancePolicy() {
          return undefined;
        },
        getGovernancePolicy() {
          return undefined;
        },
      },
      async () => ({
        agent: {
          id: 'agent-1',
          name: 'Agent',
          persona: 'test',
          model: 'model',
          mcp: 'fs',
          permissions: {
            allowed_tools: [],
            blocked_tools: [],
            rate_limit: { max_session_tokens: 1000 },
          },
          communication: { publishes: [], subscribes: [] },
          escalation: { conditions: [], escalate_to: 'human' },
        },
        mcp: { id: 'fs' },
        toolName: 'shell',
        args: { command: 'rm -rf /', cwd: '/workspace' },
        taskId: 'task-1',
        sessionId: 'session-1',
      }),
      undefined,
      (input) => {
        approvals++;
        lastApprovalScope = input.approvalScope ?? '';
        return { id: `approval-${approvals}` };
      },
    );

    const first = await tools.invoke({
      organizationId: 'org-1',
      runId: 'run-1',
      memberId: 'agent-1',
      toolCallId: 'tool-1',
      toolId: 'shell',
      action: 'execute',
      resourceType: 'shell',
      resourcePath: '/workspace',
      input: { command: 'rm -rf /', cwd: '/workspace' },
    });

    expect(first.ok).toBe(false);
    expect(first.requiresApprovalId).toBe('approval-1');
    expect(approvals).toBe(1);
    expect(lastApprovalScope).toBe('shell:{"cwd":"/workspace","command":"rm","args":["-rf","/"]}');
    expect(innerCalls).toBe(0);

    tools.allowRun('org-1', 'run-1', lastApprovalScope);
    const second = await tools.invoke({
      organizationId: 'org-1',
      runId: 'run-1',
      memberId: 'agent-1',
      toolCallId: 'tool-2',
      toolId: 'shell',
      action: 'execute',
      resourceType: 'shell',
      resourcePath: '/workspace',
      input: { command: 'rm -rf /', cwd: '/workspace' },
    });

    expect(second.ok).toBe(true);
    expect(innerCalls).toBe(1);

    const third = await tools.invoke({
      organizationId: 'org-1',
      runId: 'run-1',
      memberId: 'agent-1',
      toolCallId: 'tool-3',
      toolId: 'shell',
      action: 'execute',
      resourceType: 'shell',
      resourcePath: '/workspace',
      input: { command: 'echo hello', cwd: '/workspace' },
    });

    expect(third.ok).toBe(false);
    expect(third.requiresApprovalId).toBe('approval-2');
    expect(approvals).toBe(2);
    expect(innerCalls).toBe(1);
  });

  it('records a waiting step when the permission gate requests approval', async () => {
    let recorded: { toolCallId: string; approvalId: string } | undefined;
    const inner: ToolService = {
      async invoke() {
        return { ok: true, output: { status: 'completed' } };
      },
      allowRun() {
        return undefined;
      },
    };

    const tools = createPermissionGatedToolService(
      inner,
      {
        async check() {
          return {
            allowed: false,
            reason: 'approval required',
            code: 'requires_approval',
            gate: 'approval',
          };
        },
        async recordUsage() {
          return undefined;
        },
        async recordCompletedCall() {
          return undefined;
        },
        setSessionOverride() {
          return undefined;
        },
        clearSessionOverride() {
          return undefined;
        },
        setGovernancePolicy() {
          return undefined;
        },
        getGovernancePolicy() {
          return undefined;
        },
      },
      async () => ({
        agent: {} as never,
        mcp: { id: 'fs' },
        toolName: 'shell',
        args: {},
        taskId: 'task-1',
        sessionId: 'session-1',
      }),
      undefined,
      () => ({ id: 'approval-1' }),
      (input, approvalId) => {
        recorded = { toolCallId: input.toolCallId, approvalId };
      },
    );

    const result = await tools.invoke({
      organizationId: 'org-1',
      runId: 'run-1',
      memberId: 'agent-1',
      toolCallId: 'tool-1',
      toolId: 'shell',
      action: 'execute',
      resourceType: 'shell',
      resourcePath: '/workspace',
      input: { cwd: '/workspace', command: 'echo hello' },
    });

    expect(result.requiresApprovalId).toBe('approval-1');
    expect(recorded).toEqual({ toolCallId: 'tool-1', approvalId: 'approval-1' });
  });

  it('bypassPermission skips the middleware check and routes straight to the inner tool', async () => {
    // The resume-after-approval path (replayApprovedToolSteps) sets
    // bypassPermission=true when re-invoking an already-approved
    // dispatch tool. Without this short-circuit firing here, the
    // middleware would re-evaluate the policy and re-create an
    // approval row — the dispatch-tier retry loop the dogfood test
    // surfaced. Locks in the contract: both wrappers (outer here,
    // inner in tool-service-impl) must agree to skip when the flag
    // is set.
    let permissionCheckCount = 0;
    let innerCallCount = 0;
    const inner: ToolService = {
      async invoke() {
        innerCallCount++;
        return { ok: true, output: { real: 'result' } };
      },
      allowRun() {
        return undefined;
      },
    };
    const tools = createPermissionGatedToolService(
      inner,
      {
        async check() {
          permissionCheckCount++;
          // Even if the gate WOULD say require_approval, bypass must
          // skip it entirely.
          return {
            allowed: false,
            reason: 'should not be consulted on bypassPermission',
            code: 'requires_approval',
            gate: 'approval',
          };
        },
        async recordUsage() { return undefined; },
        async recordCompletedCall() { return undefined; },
        setSessionOverride() { return undefined; },
        clearSessionOverride() { return undefined; },
        setGovernancePolicy() { return undefined; },
        getGovernancePolicy() { return undefined; },
      },
      async () => ({
        agent: {
          id: 'agent-1', name: 'Agent', persona: 'p', model: 'm', mcp: 'fs',
          permissions: { allowed_tools: [], blocked_tools: [], rate_limit: { max_session_tokens: 1000 } },
          communication: { publishes: [], subscribes: [] },
          escalation: { conditions: [], escalate_to: 'human' },
        },
        mcp: { id: 'fs' },
        toolName: 'mcp',
        args: {},
        taskId: 'task-1',
        sessionId: 'session-1',
      }),
      undefined,
      () => ({ id: 'unused-approval' }),
    );

    const result = await tools.invoke({
      organizationId: 'org-1',
      runId: 'run-1',
      memberId: 'agent-1',
      toolCallId: 'tool-bypass-1',
      toolId: 'mcp',
      action: 'mcp',
      resourceType: 'mcp',
      resourcePath: 'srv:tool',
      input: { mcpServerId: 'srv', mcpServerName: 'srv', toolName: 'tool', args: {} },
      bypassPermission: true,
    });

    // Middleware was NOT consulted (bypass short-circuits both wrappers).
    expect(permissionCheckCount).toBe(0);
    // Inner WAS invoked and returned the real tool result.
    expect(innerCallCount).toBe(1);
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ real: 'result' });
  });
});

describe('ToolServiceImpl goal mode', () => {
  it('uses auto-review approval instead of creating a human approval', async () => {
    let approvals = 0;
    let modelResolves = 0;
    let reviews = 0;
    const team = loadAgentTeam({
      name: 'Auto Review Org',
      workspace: { root: process.cwd() },
      policies: { shellApprovalMode: 'auto_review' },
      providers: { openai: { kind: 'openai', defaultModel: 'gpt-5.4', models: ['gpt-5.4'] } },
      roles: [{
        name: 'engineer',
        title: 'Engineer',
        instructions: 'Build.',
        provider: 'openai',
        model: 'gpt-5.4',
        workspaceScopes: ['.'],
        tools: ['shell'],
        channels: ['general'],
      }],
      agents: [{ name: 'Agent', roleName: 'engineer' }],
      channels: [{ name: 'general', kind: 'general', topic: 'General' }],
    } as Record<string, unknown>);
    const store = createTeamStore();
    store.setTeam(team, 'org-1');

    const service = new ToolServiceImpl(
      store,
      {
        getRun: () => ({ id: 'run-1', threadId: 'thread-1', status: 'running' }),
        getOrganization: () => ({ id: 'org-1', workspace: { root: process.cwd() } }),
        getWorkspaceMember: () => null,
        saveWorkspaceMember: (workspaceMember: unknown) => workspaceMember,
        getMember: () => ({
          id: 'agent-1',
          organizationId: 'org-1',
          kind: 'agent',
          roleName: 'engineer',
          name: 'Agent',
          shellApprovalMode: 'auto_review',
        }),
        getLatestHumanMessageInThread: () => null,
        hasApprovalGrant: () => false,
        saveAuditEvent: () => undefined,
        listRunSteps: () => [],
        saveRunStep: () => undefined,
      } as never,
      { requestApproval: () => { approvals++; return { id: 'approval-1' }; } },
      {} as never,
      {} as never,
      { emit: () => undefined } as never,
      {} as never,
      new ApprovedRunScopeTracker(),
      undefined,
      () => {
        modelResolves++;
        return {} as never;
      },
      {
        review: async () => {
          reviews++;
          return { decision: 'approve', rationale: 'safe test command' };
        },
      },
    );

    const result = await service.invoke({
      organizationId: 'org-1',
      runId: 'run-1',
      memberId: 'agent-1',
      threadId: 'thread-1',
      toolCallId: 'tool-1',
      toolId: 'shell',
      action: 'execute',
      resourceType: 'shell',
      resourcePath: process.cwd(),
      input: { command: 'printf ok', cwd: process.cwd() },
    });

    expect(result.ok).toBe(true);
    expect(approvals).toBe(0);
    expect(modelResolves).toBe(1);
    expect(reviews).toBe(1);
  });

  it('does not approval-gate trusted goal tools in goal mode', async () => {
    let approvals = 0;
    let updates = 0;
    const team = loadAgentTeam({
      name: 'Goal Org',
      workspace: { root: process.cwd() },
      providers: { openai: { kind: 'openai', defaultModel: 'gpt-5.4', models: ['gpt-5.4'] } },
      roles: [{
        name: 'planner',
        title: 'Planner',
        instructions: 'Plan.',
        provider: 'openai',
        model: 'gpt-5.4',
        workspaceScopes: ['.'],
        tools: ['goal.task.update'],
        channels: ['general'],
      }],
      agents: [],
      channels: [{ name: 'general', kind: 'general', topic: 'General' }],
    } as Record<string, unknown>);
    const store = createTeamStore();
    store.setTeam(team, 'org-1');

    const service = new ToolServiceImpl(
      store,
      {
        getRun: () => ({ id: 'run-1', threadId: 'thread-1', status: 'running' }),
        getMember: () => ({ id: 'agent-1', organizationId: 'org-1', kind: 'agent', roleName: 'planner', name: 'Planner' }),
        getLatestHumanMessageInThread: () => ({ metadata: { goalMode: true } }),
        saveAuditEvent: () => undefined,
        listRunSteps: () => [],
        saveRunStep: () => undefined,
      } as never,
      { requestApproval: () => { approvals++; return { id: 'approval-1' }; } },
      {} as never,
      {
        updateTask: () => {
          updates++;
          return { status: 'completed', task: { id: 'task-1' } };
        },
      } as never,
      { emit: () => undefined } as never,
      {} as never,
      new ApprovedRunScopeTracker(),
    );

    const result = await service.invoke({
      organizationId: 'org-1',
      runId: 'run-1',
      memberId: 'agent-1',
      threadId: 'thread-1',
      toolCallId: 'tool-1',
      toolId: 'goal.task.update',
      action: 'update',
      resourceType: 'goal_task',
      resourcePath: 'task-1',
      input: { task_id: 'task-1', status: 'completed' },
      bypassPermission: true,
    });

    expect(result.ok).toBe(true);
    expect(approvals).toBe(0);
    expect(updates).toBe(1);
  });
});
