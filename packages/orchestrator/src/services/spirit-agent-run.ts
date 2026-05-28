import { randomUUID } from 'node:crypto';
import { stepCountIs, tool, type ToolSet } from 'ai';
import type { McpToolDescriptor } from '@ujima/shared';
import { toModelToolErrorOutput, toModelToolOutput } from './tool-loop-result.js';
import type { SpiritMcpResolution } from './spirit-types.js';
import { mcpPermissionToolName } from './mcp-runtime.js';
import {
  buildMcpNamespace,
  mcpToolInputSchema,
  sanitizeMcpToolName,
  uniqueMcpToolId,
  type McpServerSummary,
} from './spirit-mcp-helpers.js';
import {
  MessageSchema,
  SocketEventNames,
  SpiritSchema,
  channelRoom,
  orgRoom,
  type MessageCard,
  type MessageToolCall,
  type Spirit,
  type SpiritRole,
  type WakeReason,
  AGENT_KIND,
} from '@ujima/shared';
import { buildAgentSystemPrompt, type AgentTeamHandle } from '@ujima/framework';
import {
  filterToolsForWakeReplyPolicy,
  resolveWakeReplyPolicy,
} from '../utils/wake-reply-policy.js';
import { requireTeam } from '../utils/require-team.js';
import { runAgentLoop } from './agent-loop.js';
import { toModelMessages, buildToolDefinitions } from '../utils/to-model-messages.js';
import {
  ALWAYS_AVAILABLE_AGENT_TOOLS,
  SUPERVISOR_TOOL_ALLOWLIST,
} from '../tools/index.js';
import type { ApiRepository } from './repository-reader.js';
import { findToolApprovalRequiredError } from './tool-loop-result.js';
import { extractReasoningChunk } from '../utils/extract-reasoning.js';
import { errorMessage } from '../utils/error-message.js';
import { buildRunTranscript } from '../utils/run-transcript.js';
import { appendGoalArtifactToolCall } from './goal-artifact-card.js';
import { pendingApprovalRunSummary } from './approval-summary.js';
import {
  findTerminatingTool,
  findTerminatingToolFromRunSteps,
} from './run-reply-guard.js';
import {
  createMessageCursor,
  isMessageAfterCursor,
  moveCursor,
} from '../utils/message-interrupts.js';
import type { RunSpiritInput, RunSpiritOutcome } from './spirit-types.js';
import { isToolCardError } from './spirit-run-detail.js';
import { SpiritServiceLifecycle } from './spirit-lifecycle.js';

export class SpiritServiceAgentRun extends SpiritServiceLifecycle {
  async run(input: RunSpiritInput): Promise<RunSpiritOutcome> {
    const role = input.role ?? 'worker';
    const session = this.repo.getTaskSession(input.organizationId, input.taskSessionId);
    if (!session) {
      throw new Error(`Task session not found: ${input.taskSessionId}`);
    }
    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) {
      throw new Error(`Member not found: ${input.memberId}`);
    }
    const team = requireTeam(this.teamStore, input.organizationId);
    const organization = this.repo.getOrganization(input.organizationId);
    if (!organization) {
      throw new Error(`Organization not found: ${input.organizationId}`);
    }
    const agent = team.getAgent(member.id) ?? team.getAgent(member.name);
    if (!agent) {
      throw new Error(`Agent not found: ${member.id}`);
    }
    const teamRole = team.getRole(agent.roleName);
    if (!teamRole) {
      throw new Error(`Role not found: ${agent.roleName}`);
    }

    const model = await Promise.resolve(
      this.modelResolver({
        organizationId: input.organizationId,
        memberId: input.memberId,
        role,
      }),
    );

    const recent = this.repo
      .listChannelMessages(input.organizationId, session.channelId, { limit: 20 })
      .data;
    const messages = toModelMessages(recent, member.id);
    const interruptCursor = createMessageCursor(recent);
    if (input.extraPrompt) {
      messages.push({ role: 'user', content: input.extraPrompt });
    } else {
      messages.push({
        role: 'user',
        content: session.prompt || 'Continue the task.',
      });
    }

    const spirit = this.spawn({
      organizationId: input.organizationId,
      taskSessionId: input.taskSessionId,
      memberId: input.memberId,
      role,
    });
    const runTranscript = buildRunTranscript(
      this.repo.listRunSteps(input.organizationId, spirit.runId ?? spirit.id),
    );
    if (runTranscript) {
      messages.push({ role: 'user', content: runTranscript });
    }

    const running: Spirit = SpiritSchema.parse({
      ...spirit,
      status: 'running',
      updatedAt: new Date().toISOString(),
    });
    this.repo.saveSpirit(running);
    this.registry.register(running);
    if (spirit.runId) {
      const run = this.repo.getRun(input.organizationId, spirit.runId);
      if (run) {
        this.repo.saveRun({ ...run, status: 'running', step: 'running', summary: 'Spirit turn' });
      }
    }
    this.emit(SocketEventNames.spiritUpdated, running);

    const resolvedAllowlist = this.resolveToolAllowlist(teamRole.tools, role, input.toolAllowlist);
    const supervisorRunRow =
      spirit.runId !== undefined
        ? this.repo.getRun(input.organizationId, spirit.runId)
        : undefined;
    const supervisorWakePolicy = resolveWakeReplyPolicy({
      threadId: session.channelId,
      wakeReason: supervisorRunRow?.wakeReason as WakeReason | undefined,
    });
    const allowedToolIds = filterToolsForWakeReplyPolicy(
      resolvedAllowlist,
      supervisorWakePolicy,
    );
    const builtInToolDefs = this.buildToolDefinitions(allowedToolIds, {
      organizationId: input.organizationId,
      runId: spirit.runId ?? spirit.id,
      memberId: input.memberId,
      threadId: session.channelId,
      taskSessionId: input.taskSessionId,
      spiritRole: role,
      team,
      repo: this.repo,
    });
    const { toolSet: mcpToolDefs, servers: attachedMcpServers } = await this.buildMcpToolDefinitions({
      organizationId: input.organizationId,
      memberId: input.memberId,
      runId: spirit.runId ?? spirit.id,
      threadId: session.channelId,
      taskSessionId: input.taskSessionId,
      role,
    });
    const toolDefs: ToolSet = { ...builtInToolDefs, ...mcpToolDefs };

    const availableToolIds = Object.keys(toolDefs);
    const availableSkills = this.repo.listOrganizationSkillInstalls?.(input.organizationId) ?? [];
    const system = buildAgentSystemPrompt(
      team.workspace.root,
      organization.name,
      member.id,
      member.name,
      session.channelId,
      agent,
      teamRole,
      this.repo
        .listMembers(input.organizationId)
        .filter((current) => current.id !== member.id),
      team.agents,
      team.channels,
      organization.organizationChart,
      availableSkills,
      availableToolIds,
      attachedMcpServers.map((s) => ({ name: s.serverName, toolNames: s.toolNames })),
      supervisorWakePolicy.conversationKind,
    );
    const systemPromptSuffix = this.resolveSystemPromptSuffix({
      organizationId: input.organizationId,
      taskSessionId: input.taskSessionId,
      threadId: session.channelId,
      extraSuffix: input.systemPromptSuffix,
      messageContent: input.promptMessageContent,
      goalMode: input.promptGoalMode,
    });
    const systemPrompt = systemPromptSuffix ? `${system}\n\n${systemPromptSuffix}` : system;

    const maxIterations = input.maxIterations ?? this.maxIterationsPerRun;
    let totalTurns = 0;
    let totalToolCalls = 0;
    let totalTokens = 0;
    let lastText = '';
    let streamedReasoning = '';

    try {
      const result = await runAgentLoop({
        model,
        system: systemPrompt,
        messages,
        tools: toolDefs,
        stopWhen: stepCountIs(maxIterations),
        ...(this.maxOutputTokens !== undefined ? { maxOutputTokens: this.maxOutputTokens } : {}),
        temperature: this.temperature,
        toolChoice: 'required-first-step',
        onChunk: (chunk) => {
          if (chunk.kind === 'reasoning') streamedReasoning += chunk.delta;
          this.emitRunChunk(
            {
              organizationId: input.organizationId,
              runId: spirit.runId ?? spirit.id,
              threadId: session.channelId,
              agentId: input.memberId,
            },
            chunk,
          );
        },
        loadInterruptMessages: () => {
          const page = this.repo
            .listChannelMessages(input.organizationId, session.channelId, { limit: 100 })
            .data;
          const interrupts = page.filter(
            (message) =>
              message.kind === 'human' &&
              message.senderId !== member.id &&
              isMessageAfterCursor(message, interruptCursor),
          );
          const latest = page.at(-1);
          if (latest) {
            moveCursor(interruptCursor, latest);
          }
          return toModelMessages(interrupts, member.id);
        },
      });
      const { steps, usage } = result;

      // Each step in `steps` is one model turn. We persist one
      // `kind='agent'` message per step that produced text or tool
      // calls, with tool-call cards inlined. This keeps the channel
      // history readable as a turn-by-turn timeline.
      let lastMessageId: string | undefined;
      for (const [index, step] of steps.entries()) {
        totalTurns += 1;
        const stepText = typeof step.text === 'string' ? step.text : '';
        const stepToolCalls = Array.isArray(step.toolCalls) ? step.toolCalls : [];
        const stepToolResults = Array.isArray(step.toolResults) ? step.toolResults : [];
        totalToolCalls += stepToolCalls.length;

        if (!stepText && stepToolCalls.length === 0) {
          continue;
        }

        const toolCalls = this.toMessageToolCalls(stepToolCalls, stepToolResults, spirit);
        const goalArtifactToolCall = await appendGoalArtifactToolCall(
          stepToolCalls,
          team.workspace.root,
        );
        const messageToolCalls = goalArtifactToolCall ? [...toolCalls, goalArtifactToolCall] : toolCalls;
        const reasoningContent =
          extractReasoningChunk(step) ??
          (index === steps.length - 1 ? streamedReasoning.trim() || undefined : undefined);
        if (!stepText && !goalArtifactToolCall) {
          continue;
        }
        const message = MessageSchema.parse({
          id: randomUUID(),
          organizationId: input.organizationId,
          threadId: session.channelId,
          channelId: session.channelId,
          senderId: member.id,
          senderKind: AGENT_KIND,
          kind: AGENT_KIND,
          content: stepText || 'Goal artifact updated.',
          toolCalls: messageToolCalls,
          metadata: { runId: spirit.runId ?? spirit.id },
          ...(reasoningContent ? { reasoningContent } : {}),
          createdAt: new Date().toISOString(),
        });
        this.repo.saveMessage(message);
        this.realtime.emit(
          SocketEventNames.channelMessage,
          {
            organizationId: input.organizationId,
            channelId: session.channelId,
            message,
          },
          [orgRoom(input.organizationId), channelRoom(session.channelId)],
        );
        lastText = stepText || lastText;
        lastMessageId = message.id;
      }

      // Prefer the provider-supplied `totalTokens` over our own
      // input+output sum. Some providers (and the V3 mock used in
      // tests) return non-numeric fields on `inputTokens` /
      // `outputTokens` that wouldn't sum to a number — and even when
      // they're flat, the sum can drift from `totalTokens` because
      // it ignores reasoning/cached tokens that the provider counts.
      // Falling back to the sum preserves behaviour when the provider
      // omits `totalTokens`. Coercing through `Number()` defends
      // against accidental non-numeric leaks reaching SpiritSchema's
      // `z.number().int().min(0)` validator.
      const usageInput = Number(usage?.inputTokens ?? 0) || 0;
      const usageOutput = Number(usage?.outputTokens ?? 0) || 0;
      const usageTotal = Number(usage?.totalTokens ?? 0);
      totalTokens = Number.isFinite(usageTotal) && usageTotal > 0
        ? usageTotal
        : usageInput + usageOutput;
      if (!Number.isFinite(totalTokens) || totalTokens < 0) {
        totalTokens = 0;
      }
      const completed: Spirit = SpiritSchema.parse({
        ...running,
        iteration: running.iteration + totalTurns,
        tokensUsed: running.tokensUsed + totalTokens,
        lastMessageId: lastMessageId ?? running.lastMessageId,
        status: 'completed',
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
      this.repo.saveSpirit(completed);
      this.registry.unregister(completed.organizationId, completed.memberId, completed.id);
      // Persisted run-steps act as a safety net when provider/SDK
      // result shapes drop tool names from the final step object —
      // the tool service writes the canonical id after each call.
      const persistedRunSteps = spirit.runId
        ? this.repo.listRunSteps?.(input.organizationId, spirit.runId) ?? []
        : [];
      const detectedTerminatingTool =
        findTerminatingTool(result) ?? findTerminatingToolFromRunSteps(persistedRunSteps);
      // Resolve the final terminator, preserving any silent
      // terminator a mid-run side-effect (mirror-loop guard, vacuous-
      // ack suppression) already wrote onto the run row. Without this
      // preservation step, the freshly-computed `detected` value
      // (which sees the model's original `channel.reply` toolcall via
      // `result.steps`) would clobber the `channel.ack` that the
      // mirror-suppress flow persisted earlier — and metrics would
      // report a publish that never actually went through.
      const persistedRun = spirit.runId
        ? this.repo.getRun(input.organizationId, spirit.runId)
        : null;
      const persistedTerminator = persistedRun?.terminatingTool;
      const persistedIsSilent =
        persistedTerminator === 'channel.ack' || persistedTerminator === 'channel.pass';
      const terminatingTool = persistedIsSilent
        ? persistedTerminator
        : detectedTerminatingTool;
      if (persistedRun) {
        this.repo.saveRun({
          ...persistedRun,
          status: 'completed',
          step: 'completed',
          summary: lastText || persistedRun.summary,
          endedAt: new Date().toISOString(),
          terminatingTool,
        });
      }
      this.emit(SocketEventNames.spiritCompleted, completed);
      this.maybeFinalizeTaskSession(
        completed.organizationId,
        completed.taskSessionId,
        lastText || undefined,
      );

      return {
        spirit: completed,
        finalText: lastText,
        iterations: totalTurns,
        toolCalls: totalToolCalls,
        tokensUsed: totalTokens,
        terminatingTool,
      };
    } catch (err) {
      if (findToolApprovalRequiredError(err)) {
        const waiting: Spirit = SpiritSchema.parse({
          ...running,
          status: 'waiting_for_approval',
          updatedAt: new Date().toISOString(),
        });
        this.repo.saveSpirit(waiting);
        // Approval-paused turns: a tool fired but its result is
        // deferred, so we can only consult persisted run-steps here.
        const pausedRunSteps = spirit.runId
          ? this.repo.listRunSteps?.(input.organizationId, spirit.runId) ?? []
          : [];
        const pausedTerminatingTool = findTerminatingToolFromRunSteps(pausedRunSteps);
        if (spirit.runId) {
          const run = this.repo.getRun(input.organizationId, spirit.runId);
          if (run) {
            this.repo.saveRun({
              ...run,
              status: 'waiting_for_approval',
              step: 'waiting_for_approval',
              summary: pendingApprovalRunSummary(this.repo, input.organizationId, spirit.runId),
              terminatingTool: pausedTerminatingTool,
            });
          }
        }
        this.emit(SocketEventNames.spiritUpdated, waiting);
        return {
          spirit: waiting,
          finalText: lastText,
          iterations: totalTurns,
          toolCalls: totalToolCalls,
          tokensUsed: totalTokens,
          terminatingTool: pausedTerminatingTool,
        };
      }
      const message = errorMessage(err);
      const failed: Spirit = SpiritSchema.parse({
        ...running,
        status: 'failed',
        lastError: message,
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
      this.repo.saveSpirit(failed);
      this.registry.unregister(failed.organizationId, failed.memberId, failed.id);
      // Mirror terminatingTool on the failure path too — a turn can
      // fail after a tool fired (e.g. policy block on a later step),
      // and postmortem analysis benefits from seeing that the agent
      // *did* terminate via a specific tool before the run died.
      const failedRunSteps = spirit.runId
        ? this.repo.listRunSteps?.(input.organizationId, spirit.runId) ?? []
        : [];
      const failedTerminatingTool = findTerminatingToolFromRunSteps(failedRunSteps);
      if (spirit.runId) {
        const run = this.repo.getRun(input.organizationId, spirit.runId);
        if (run) {
          this.repo.saveRun({
            ...run,
            status: 'failed',
            step: 'failed',
            summary: message,
            endedAt: new Date().toISOString(),
            terminatingTool: failedTerminatingTool,
          });
        }
      }
      this.emit(SocketEventNames.spiritCompleted, failed);
      this.maybeFinalizeTaskSession(failed.organizationId, failed.taskSessionId, message);
      throw err;
    }
  }

  protected resolveToolAllowlist(
    roleTools: readonly string[],
    role: SpiritRole,
    override: readonly string[] | undefined,
  ): readonly string[] {
    if (override) return override;
    if (role === 'supervisor') {
      return SUPERVISOR_TOOL_ALLOWLIST;
    }
    return [...new Set([...roleTools, ...ALWAYS_AVAILABLE_AGENT_TOOLS])];
  }

  protected buildToolDefinitions(
    toolIds: readonly string[],
    ctx: {
      organizationId: string;
      runId: string;
      memberId: string;
      threadId: string;
      taskSessionId: string;
      spiritRole: SpiritRole;
      team: AgentTeamHandle;
      repo?: ApiRepository;
    },
  ): ToolSet {
    return buildToolDefinitions(toolIds, ctx.team, this.tools, ctx);
  }

  protected toMessageToolCalls(
    stepToolCalls: readonly { toolCallId?: string; toolName?: string; input?: unknown }[],
    stepToolResults: readonly { toolCallId?: string; output?: unknown }[],
    spirit: Spirit,
  ): MessageToolCall[] {
    const resultsById = new Map<string, unknown>();
    for (const r of stepToolResults) {
      if (typeof r.toolCallId === 'string') {
        resultsById.set(r.toolCallId, r.output);
      }
    }
    return stepToolCalls.map((call) => {
      const toolCallId = call.toolCallId ?? randomUUID();
      const toolName = call.toolName ?? 'unknown';
      const args = (call.input as Record<string, unknown> | undefined) ?? {};
      const result = resultsById.get(toolCallId);
      const isError = isToolCardError(result);
      const card: MessageCard = {
        kind: 'tool.call',
        cardId: randomUUID(),
        taskSessionId: spirit.taskSessionId,
        runId: spirit.runId,
        toolCallId,
        toolName,
        args,
        result,
        isError,
      };
      return {
        toolCallId,
        toolName,
        args,
        result: card,
        isError,
      };
    });
  }

  async buildMcpToolDefinitions(ctx: {
    organizationId: string;
    memberId: string;
    runId: string;
    threadId: string;
    taskSessionId: string;
    role: SpiritRole;
  }): Promise<{ toolSet: ToolSet; servers: McpServerSummary[] }> {
    if (!this.mcpPool || !this.mcpResolver) return { toolSet: {} as ToolSet, servers: [] };
    let resolutions: SpiritMcpResolution[];
    try {
      resolutions = await this.mcpResolver({
        organizationId: ctx.organizationId,
        memberId: ctx.memberId,
        role: ctx.role,
      });
    } catch {
      return { toolSet: {} as ToolSet, servers: [] };
    }
    if (resolutions.length === 0) return { toolSet: {} as ToolSet, servers: [] };

    type ToolEntry = readonly [
      string,
      {
        toolName: string;
        description: string;
        serverId: string;
        serverName: string;
        inputSchema?: Record<string, unknown>;
      },
    ];
    const entries: ToolEntry[] = [];
    const servers: McpServerSummary[] = [];
    const usedToolIds = new Set<string>();
    const pool = this.mcpPool;
    for (const resolution of resolutions) {
      let toolList: McpToolDescriptor[] = [];
      try {
        const connection = await pool.get(resolution.def, { agentId: ctx.memberId });
        const liveTools = await connection.listTools();
        toolList = liveTools.map((t) => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema:
            t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
              ? (t.inputSchema as Record<string, unknown>)
              : undefined,
        }));
      } catch {
        toolList = this.repo.getMcpToolCache(ctx.organizationId, resolution.serverId)?.tools ?? [];
      }

      // Per-tool grant filter. When the agent has at least one row in
      // agent_tool_attachments for this server, narrow the palette to
      // exactly those tools. Zero rows = "all tools" mode (back-compat).
      // Shrinking the palette also shrinks the model prompt.
      const grants = this.repo.listAgentToolAttachments(
        ctx.organizationId,
        ctx.memberId,
        resolution.serverId,
      );
      if (grants.length > 0) {
        const allowedNames = new Set(grants.map((g) => g.toolName));
        toolList = toolList.filter((t) => allowedNames.has(t.name));
      }

      const nsSlug = buildMcpNamespace(resolution.serverName, resolution.serverId);
      if (toolList.length > 0) {
        servers.push({
          serverName: resolution.serverName,
          serverId: resolution.serverId,
          toolNames: toolList.map((t) => t.name),
        });
      }
      for (const t of toolList) {
        const baseToolId = `mcp__${nsSlug}__${sanitizeMcpToolName(t.name)}`;
        const aiToolId = uniqueMcpToolId(baseToolId, resolution.serverId, t.name, usedToolIds);
        entries.push([
          aiToolId,
          {
            toolName: t.name,
            description: t.description || `${resolution.serverName}.${t.name}`,
            serverId: resolution.serverId,
            serverName: resolution.serverName,
            inputSchema:
              t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
                ? (t.inputSchema as Record<string, unknown>)
                : undefined,
          },
        ]);
      }
    }
    const toolSet = Object.fromEntries(
      entries.map(([aiToolId, entry]) => [
        aiToolId,
        tool({
          description: entry.description,
          inputSchema: mcpToolInputSchema(entry.inputSchema),
          execute: async (rawArgs, { toolCallId }) => {
            const args = (rawArgs ?? {}) as Record<string, unknown>;
            try {
              const result = await this.tools.invoke({
                organizationId: ctx.organizationId,
                runId: ctx.runId,
                memberId: ctx.memberId,
                threadId: ctx.threadId,
                taskSessionId: ctx.taskSessionId,
                spiritRole: ctx.role,
                toolCallId,
                toolId: 'mcp',
                action: 'mcp',
                resourceType: 'mcp',
                resourcePath: `${entry.serverId}:${entry.toolName}`,
                permissionMcpId: entry.serverId,
                // Synthetic id namespaces MCP tools away from built-in tool ids
                // (e.g. `self.note`) for the legacy allowed_tools match path.
                // Governance reads the raw name from input.toolName below.
                permissionToolName: mcpPermissionToolName(entry.serverId, entry.toolName),
                input: {
                  mcpServerId: entry.serverId,
                  mcpServerName: entry.serverName,
                  toolName: entry.toolName,
                  args,
                },
              });
              return toModelToolOutput(result);
            } catch (error) {
              return toModelToolErrorOutput(error);
            }
          },
        }),
      ]),
    ) as ToolSet;
    return { toolSet, servers };
  }
}
