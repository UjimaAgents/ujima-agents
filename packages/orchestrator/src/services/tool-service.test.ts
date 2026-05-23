import { describe, expect, it } from 'vitest';
import { createPermissionGatedToolService, type ToolService } from './tool-service.js';

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
            rate_limit: { calls_per_minute: 30, max_session_tokens: 1000 },
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

    tools.allowRun('org-1', 'run-1');
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
      input: { command: 'rm -rf /', cwd: '/workspace' },
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

  it('does not spend a scoped approval on a different command', async () => {
    let innerCalls = 0;

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
          return undefined as never;
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
      () => ({ id: 'approval-1' }),
    );

    const approvedScope = 'shell:{"cwd":"/workspace","command":"git","args":["status"]}';
    tools.allowRun('org-1', 'run-1', approvedScope);

    const other = await tools.invoke({
      organizationId: 'org-1',
      runId: 'run-1',
      memberId: 'agent-1',
      toolCallId: 'tool-1',
      toolId: 'shell',
      action: 'execute',
      resourceType: 'shell',
      resourcePath: '/workspace',
      input: { command: 'git log', cwd: '/workspace' },
    });

    const approved = await tools.invoke({
      organizationId: 'org-1',
      runId: 'run-1',
      memberId: 'agent-1',
      toolCallId: 'tool-2',
      toolId: 'shell',
      action: 'execute',
      resourceType: 'shell',
      resourcePath: '/workspace',
      input: { command: 'git status', cwd: '/workspace' },
    });

    expect(other.ok).toBe(false);
    expect(approved.ok).toBe(true);
    expect(innerCalls).toBe(1);
  });

  it('returns structured denial with code and records run step for rate_limited', async () => {
    const denials: { code?: string; toolCallId: string }[] = [];
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
            reason: 'Agent "agent-1" exceeded rate limit of 30 calls/min',
            code: 'rate_limited',
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
        toolName: 'view',
        args: {},
        taskId: 'task-1',
        sessionId: 'session-1',
      }),
      undefined,
      undefined,
      (_input, decision) => {
        denials.push({ code: decision.code, toolCallId: _input.toolCallId });
      },
    );

    const result = await tools.invoke({
      organizationId: 'org-1',
      runId: 'run-1',
      memberId: 'agent-1',
      toolCallId: 'tool-rate-1',
      toolId: 'view',
      action: 'read',
      resourceType: 'file',
      resourcePath: '/workspace/foo.ts',
      input: {},
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('rate_limited');
    expect(result.output).toEqual({
      status: 'blocked',
      code: 'rate_limited',
      error: 'Agent "agent-1" exceeded rate limit of 30 calls/min',
    });
    expect(denials).toEqual([{ code: 'rate_limited', toolCallId: 'tool-rate-1' }]);
  });
});
