import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import type { AgentTeamHandle } from '@ujima/framework';
import {
  SocketEventNames,
  memberRoom,
  runRoom,
  type AuditStatus,
} from '@ujima/shared';
import { assertWorkspaceBoundary } from '@ujima/shared/workspace';
import type { RealtimeService } from './context.js';
import type { ConversationService } from './conversation.js';
import { checkToolPolicy } from './policy.js';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import type {
  ToolInvocationInput,
  ToolInvocationResult,
  ToolService,
} from './tool-service.js';

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

    this.realtime.emit(
      SocketEventNames.toolCalled,
      {
        organizationId: invocation.organizationId,
        runId: invocation.runId,
        agentId: invocation.memberId,
        toolCall: {
          toolCallId: invocation.toolCallId,
          toolName: invocation.toolId,
          args: invocation.input,
        },
      },
      rooms,
    );

    const policy = checkToolPolicy(
      this.requireTeam(),
      member.roleName,
      invocation.toolId,
      invocation.action,
      invocation.resourcePath,
    );

    if (!policy.allowed) {
      this.audit(invocation, 'blocked', { reason: policy.reason });

      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: invocation.organizationId,
          runId: invocation.runId,
          agentId: invocation.memberId,
          toolResult: {
            toolCallId: invocation.toolCallId,
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
        organizationId: invocation.organizationId,
        runId: invocation.runId,
        requestedBy: invocation.memberId,
        resourceType: invocation.resourceType,
        resourcePath: invocation.resourcePath ?? '',
        action: invocation.action,
        reason: 'Tool action requires approval',
      });

      this.audit(invocation, 'ok', { approvalId: approval.id, status: 'pending_approval' });

      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: invocation.organizationId,
          runId: invocation.runId,
          agentId: invocation.memberId,
          toolResult: {
            toolCallId: invocation.toolCallId,
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
      const result = await this.executeTool(invocation);
      this.audit(invocation, 'ok', { status: 'completed' });

      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: invocation.organizationId,
          runId: invocation.runId,
          agentId: invocation.memberId,
          toolResult: { toolCallId: invocation.toolCallId, result, isError: false },
        },
        rooms,
      );

      return { ok: true, output: { status: 'completed', result } };
    } catch (error) {
      const message = (error as Error).message;
      this.audit(invocation, 'error', { error: message });

      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: invocation.organizationId,
          runId: invocation.runId,
          agentId: invocation.memberId,
          toolResult: {
            toolCallId: invocation.toolCallId,
            result: { error: message },
            isError: true,
          },
        },
        rooms,
      );

      throw error;
    }
  }

  private async executeTool(invocation: ToolInvocationInput): Promise<unknown> {
    if (invocation.toolId === 'filesystem') {
      if (invocation.action === 'read') {
        return this.readFilesystemResource(invocation);
      }
      if (invocation.action === 'write') {
        return this.writeFilesystemResource(invocation);
      }
    }

    if (invocation.toolId === 'shell') {
      return this.executeShell(invocation);
    }

    if (invocation.toolId === 'mcp') {
      throw new Error('MCP proxying is not yet implemented in the local runtime');
    }

    if (invocation.toolId === 'message') {
      return this.sendMessage(invocation);
    }

    throw new Error(
      `Tool "${invocation.toolId}" action "${invocation.action}" is not implemented`,
    );
  }

  private sendMessage(invocation: ToolInvocationInput) {
    const destination = invocation.input?.destination as string | undefined;
    const content = invocation.input?.content as string | undefined;
    const mentions = Array.isArray(invocation.input?.mentions)
      ? invocation.input.mentions.filter((mention): mention is string => typeof mention === 'string')
      : [];

    if (typeof destination !== 'string') {
      throw new Error("Input 'destination' must be a string");
    }

    if (typeof content !== 'string') {
      throw new Error("Input 'content' must be a string");
    }

    if (destination === 'thread') {
      if (!invocation.threadId) {
        throw new Error('threadId is required for thread messages');
      }
      return this.conversations.sendMessage({
        organizationId: invocation.organizationId,
        threadId: invocation.threadId,
        senderId: invocation.memberId,
        content,
        mentions,
      });
    }

    if (destination === 'channel') {
      const channelId = invocation.input?.channelId as string | undefined;
      if (typeof channelId !== 'string') {
        throw new Error("Input 'channelId' must be a string");
      }
      if (!invocation.threadId) {
        throw new Error('threadId is required for channel messages');
      }
      return this.conversations.sendMessage({
        organizationId: invocation.organizationId,
        threadId: invocation.threadId,
        channelId,
        senderId: invocation.memberId,
        content,
        mentions,
      });
    }

    if (destination === 'dm') {
      const recipientId = invocation.input?.recipientId as string | undefined;
      if (typeof recipientId !== 'string') {
        throw new Error("Input 'recipientId' must be a string");
      }
      return this.conversations.sendDirectMessage({
        organizationId: invocation.organizationId,
        senderId: invocation.memberId,
        recipientId,
        content,
        mentions,
      });
    }

    throw new Error(`Unknown message destination "${destination}"`);
  }

  private async readFilesystemResource(invocation: ToolInvocationInput) {
    if (!invocation.resourcePath) {
      throw new Error('resourcePath is required');
    }

    const resolved = assertWorkspaceBoundary(
      this.requireTeam().workspace.root,
      invocation.resourcePath,
    );
    const resource = await stat(resolved);

    if (resource.isDirectory()) {
      const entries = await readdir(resolved);
      return {
        type: 'folder' as const,
        path: resolved,
        entries,
      };
    }

    return {
      type: 'file' as const,
      path: resolved,
      content: await readFile(resolved, 'utf8'),
    };
  }

  private async writeFilesystemResource(invocation: ToolInvocationInput) {
    if (!invocation.resourcePath) {
      throw new Error('resourcePath is required');
    }

    const resolved = assertWorkspaceBoundary(
      this.requireTeam().workspace.root,
      invocation.resourcePath,
    );
    const content = invocation.input?.content as string | undefined;

    if (typeof content !== 'string') {
      throw new Error("Input 'content' must be a string");
    }

    await writeFile(resolved, content, 'utf8');
    return { success: true, path: resolved };
  }

  private async executeShell(invocation: ToolInvocationInput) {
    const command = invocation.input?.command as string | undefined;
    const args = Array.isArray(invocation.input?.args)
      ? invocation.input.args.filter((arg): arg is string => typeof arg === 'string')
      : [];

    if (typeof command !== 'string') {
      throw new Error("Input 'command' must be a string");
    }

    return this.runProcess(command, args);
  }

  private async runProcess(command: string, args: string[]) {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: this.requireTeam().workspace.root,
        shell: false,
      });

      let stdout = '';
      let stderr = '';

      function finish(error?: Error, code?: number): void {
        clearTimeout(timeout);
        if (error) return reject(error);
        if (code !== 0) {
          return reject(
            new Error(stderr.trim() || `Command "${command}" exited with code ${code}`),
          );
        }
        resolve({ stdout, stderr });
      }

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        finish(new Error('Command timed out after 30 seconds'));
      }, 30000);

      const maxBytes = 5 * 1024 * 1024;
      const handleData = (isStdout: boolean) => (chunk: Buffer) => {
        if (isStdout) stdout += chunk.toString();
        else stderr += chunk.toString();
        if (stdout.length + stderr.length > maxBytes) {
          child.kill('SIGTERM');
          finish(new Error('Command exceeded maximum output size (5MB)'));
        }
      };

      child.stdout?.on('data', handleData(true));
      child.stderr?.on('data', handleData(false));
      child.on('error', (error) => finish(error));
      child.on('close', (code) => finish(undefined, code ?? 0));
    });
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
}
