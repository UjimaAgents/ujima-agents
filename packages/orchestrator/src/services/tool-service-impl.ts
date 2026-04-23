import { randomUUID } from 'node:crypto';
import type { AgentTeamHandle } from '@ujima/framework';
import {
  SocketEventNames,
  memberRoom,
  runRoom,
  type AuditStatus,
} from '@ujima/shared';
import type { RealtimeService } from './context.js';
import type { ConversationService } from './conversation.js';
import { checkToolPolicy } from './policy.js';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import { ORCHESTRATOR_TOOLS } from '../tools/index.js';
import type {
  ToolInvocationInput,
  ToolInvocationResult,
  ToolService,
} from './tool-service.js';
import {
  ERR_PATH_ESCAPE,
  createMemberPathResolver,
  isPathEscapeError,
} from './workspace-root.js';

export interface ApprovalRequester {
  requestApproval(input: {
    organizationId: string;
    runId: string;
    requestedBy: string;
    resourceType: ToolInvocationInput['resourceType'];
    resourcePath: string;
    action: ToolInvocationInput['action'];
    reason: string;
  }): { id: string };
}

export class ToolServiceImpl implements ToolService {
  private readonly approvedRuns = new Set<string>();

  constructor(
    private readonly teamStore: TeamStore,
    private readonly repo: ApiRepository,
    private readonly approvals: ApprovalRequester,
    private readonly conversations: ConversationService,
    private readonly realtime: RealtimeService,
  ) {}

  allowRun(organizationId: string, runId: string): void {
    this.approvedRuns.add(this.runKey(organizationId, runId));
  }

  async invoke(invocation: ToolInvocationInput): Promise<ToolInvocationResult> {
    const member = this.repo.getMember(invocation.organizationId, invocation.memberId);
    if (!member) {
      throw new Error(`Member not found: ${invocation.memberId}`);
    }

    const rooms = [runRoom(invocation.runId), memberRoom(invocation.memberId)];
    const team = this.requireTeam();
    let preparedInvocation: ToolInvocationInput;

    try {
      preparedInvocation = await this.prepareInvocation(invocation, member.roleName, team);
    } catch (error) {
      const message = (error as Error).message;
      this.audit(invocation, 'blocked', {
        error: message,
        code: isPathEscapeError(error) ? ERR_PATH_ESCAPE : undefined,
      });
      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: invocation.organizationId,
          runId: invocation.runId,
          agentId: invocation.memberId,
          toolResult: {
            toolCallId: invocation.toolCallId,
            result: {
              error: message,
              ...(isPathEscapeError(error) ? { code: ERR_PATH_ESCAPE } : {}),
            },
            isError: true,
          },
        },
        rooms,
      );
      throw error;
    }

    this.realtime.emit(
      SocketEventNames.toolCalled,
      {
        organizationId: invocation.organizationId,
        runId: invocation.runId,
        agentId: invocation.memberId,
        toolCall: {
          toolCallId: preparedInvocation.toolCallId,
          toolName: preparedInvocation.toolId,
          args: preparedInvocation.input,
        },
      },
      rooms,
    );

    const policy = checkToolPolicy(
      team,
      member.roleName,
      preparedInvocation.toolId,
      preparedInvocation.action,
      preparedInvocation.resourcePath,
    );

    if (!policy.allowed) {
      this.audit(preparedInvocation, 'blocked', { reason: policy.reason });

      this.realtime.emit(
        SocketEventNames.toolResult,
        {
            organizationId: invocation.organizationId,
            runId: preparedInvocation.runId,
            agentId: preparedInvocation.memberId,
            toolResult: {
              toolCallId: preparedInvocation.toolCallId,
              result: { error: policy.reason },
              isError: true,
            },
        },
        rooms,
      );

      return { ok: false, error: policy.reason, output: { status: 'blocked', reason: policy.reason } };
    }

    if (
      policy.requiresApproval &&
      !this.consumeApprovedRun(invocation.organizationId, invocation.runId)
    ) {
      const approval = this.approvals.requestApproval({
        organizationId: preparedInvocation.organizationId,
        runId: preparedInvocation.runId,
        requestedBy: preparedInvocation.memberId,
        resourceType: preparedInvocation.resourceType,
        resourcePath: preparedInvocation.resourcePath ?? '',
        action: preparedInvocation.action,
        reason: 'Tool action requires approval',
      });

      this.audit(preparedInvocation, 'ok', { approvalId: approval.id, status: 'pending_approval' });

      this.realtime.emit(
        SocketEventNames.toolResult,
        {
            organizationId: preparedInvocation.organizationId,
            runId: preparedInvocation.runId,
            agentId: preparedInvocation.memberId,
            toolResult: {
              toolCallId: preparedInvocation.toolCallId,
              result: { status: 'waiting_for_approval' },
              isError: false,
            },
        },
        rooms,
      );

      return {
        ok: false,
        requiresApprovalId: approval.id,
        output: { status: 'waiting_for_approval', approvalId: approval.id },
      };
    }

    try {
      const result = await this.executeTool(preparedInvocation);
      this.audit(preparedInvocation, 'ok', { status: 'completed' });

      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: preparedInvocation.organizationId,
          runId: preparedInvocation.runId,
          agentId: preparedInvocation.memberId,
          toolResult: { toolCallId: preparedInvocation.toolCallId, result, isError: false },
        },
        rooms,
      );

      return { ok: true, output: { status: 'completed', result } };
    } catch (error) {
      const message = (error as Error).message;
      this.audit(preparedInvocation, 'error', {
        error: message,
        code: isPathEscapeError(error) ? ERR_PATH_ESCAPE : undefined,
      });

      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: preparedInvocation.organizationId,
          runId: preparedInvocation.runId,
          agentId: preparedInvocation.memberId,
          toolResult: {
            toolCallId: preparedInvocation.toolCallId,
            result: {
              error: message,
              ...(isPathEscapeError(error) ? { code: ERR_PATH_ESCAPE } : {}),
            },
            isError: true,
          },
        },
        rooms,
      );

      throw error;
    }
  }

  private async executeTool(invocation: ToolInvocationInput): Promise<unknown> {
    const tool = ORCHESTRATOR_TOOLS[invocation.toolId];

    if (tool) {
      return tool.execute({
        invocation,
        team: this.requireTeam(),
        repo: this.repo,
        conversations: this.conversations,
      });
    }

    if (invocation.toolId === 'mcp') {
      throw new Error('MCP proxying is not yet implemented in the local runtime');
    }

    throw new Error(
      `Tool "${invocation.toolId}" action "${invocation.action}" is not implemented`,
    );
  }

  private requireTeam(): AgentTeamHandle {
    const team = this.teamStore.getTeam();
    if (!team) {
      throw new Error('Team config not loaded');
    }
    return team;
  }

  private consumeApprovedRun(organizationId: string, runId: string): boolean {
    const key = this.runKey(organizationId, runId);
    if (!this.approvedRuns.has(key)) {
      return false;
    }
    this.approvedRuns.delete(key);
    return true;
  }

  private runKey(organizationId: string, runId: string): string {
    return `${organizationId}:${runId}`;
  }

  private audit(
    invocation: ToolInvocationInput,
    status: AuditStatus,
    metadata: Record<string, unknown>,
  ): void {
    this.repo.saveAuditEvent({
      id: randomUUID(),
      organizationId: invocation.organizationId,
      actorId: invocation.memberId,
      action: `tool.${invocation.action}`,
      targetType: invocation.resourceType,
      targetId: invocation.toolId,
      status,
      metadata: { ...invocation.input, ...metadata },
      createdAt: new Date().toISOString(),
    });
  }

  private async prepareInvocation(
    invocation: ToolInvocationInput,
    roleName: string,
    team: AgentTeamHandle,
  ): Promise<ToolInvocationInput> {
    if (invocation.toolId !== 'filesystem' && invocation.toolId !== 'shell') {
      return invocation;
    }

    const resolver = await createMemberPathResolver(
      this.repo,
      team,
      invocation.organizationId,
      invocation.memberId,
      roleName,
    );

    if (invocation.toolId === 'filesystem') {
      if (!invocation.resourcePath) {
        return invocation;
      }
      return {
        ...invocation,
        resourcePath: await resolver.resolve(invocation.resourcePath),
      };
    }

    const input = invocation.input ?? {};
    const command = typeof input.command === 'string' ? input.command : '';
    // Shell commands can operate on the current directory even when the model
    // doesn't pass an explicit path argument, so we scope both cwd and any
    // path-like args through the same member-bound resolver before spawn().
    const requestedCwd =
      typeof input.cwd === 'string'
        ? input.cwd
        : invocation.resourcePath ?? resolver.scopePaths[0] ?? '.';
    const resolvedCwd = await resolver.resolve(requestedCwd);
    const rawArgs = Array.isArray(input.args)
      ? input.args.filter((arg): arg is string => typeof arg === 'string')
      : [];
    const args = await sanitizeShellArgs(command, rawArgs, resolver);

    return {
      ...invocation,
      resourcePath: resolvedCwd,
      input: {
        ...input,
        args,
        cwd: resolvedCwd,
      },
    };
  }
}

const SHELL_PATH_FLAGS = new Set([
  '-C',
  '-c',
  '-d',
  '-f',
  '-i',
  '-o',
  '-p',
  '--config',
  '--cwd',
  '--directory',
  '--file',
  '--input',
  '--output',
  '--path',
]);

async function sanitizeShellArgs(
  command: string,
  args: string[],
  resolver: Awaited<ReturnType<typeof createMemberPathResolver>>,
): Promise<string[]> {
  const sanitized: string[] = [];
  let expectPathFor: string | null = null;

  for (const arg of args) {
    if (expectPathFor) {
      sanitized.push(await resolver.resolve(arg));
      expectPathFor = null;
      continue;
    }

    if (SHELL_PATH_FLAGS.has(arg)) {
      sanitized.push(arg);
      expectPathFor = arg;
      continue;
    }

    const inlineFlag = splitInlinePathFlag(arg);
    if (inlineFlag) {
      sanitized.push(`${inlineFlag.flag}=${await resolver.resolve(inlineFlag.value)}`);
      continue;
    }

    if (looksLikePathArg(command, arg)) {
      sanitized.push(await resolver.resolve(arg));
      continue;
    }

    sanitized.push(arg);
  }

  return sanitized;
}

function splitInlinePathFlag(arg: string): { flag: string; value: string } | null {
  const [flag, value] = arg.split('=', 2);
  if (typeof flag !== 'string' || typeof value !== 'string' || !SHELL_PATH_FLAGS.has(flag)) {
    return null;
  }
  return { flag, value };
}

function looksLikePathArg(command: string, arg: string): boolean {
  if (!arg || arg === '-') return false;
  if (arg.includes('://')) return false;
  if (arg.startsWith('-')) return false;
  if (arg === '.' || arg === '..') return true;
  if (arg.startsWith('/') || arg.startsWith('./') || arg.startsWith('../') || arg.startsWith('~/')) {
    return true;
  }
  if (arg.includes('/') || arg.includes('\\')) {
    return true;
  }
  return command === 'cd';
}
