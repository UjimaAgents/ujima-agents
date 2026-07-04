import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import type { Message, RunStep, WakeReason } from '@ujima/shared';
import type { AgentTeamHandle } from '@ujima/framework';
import { AgentLoopLogger } from '../debug/agent-loop-logger.js';
import type { McpServerSummary } from './spirit-mcp-helpers.js';
import type { ApiRepository } from './repository-reader.js';
import type { WakeReplyPolicy } from '../utils/wake-reply-policy.js';
import { resolveWakeReplyPolicy } from '../utils/wake-reply-policy.js';
import { AGENT_KIND } from '@ujima/shared';
import { isDelegateMessage } from './run-reply-guard.js';
import {
  buildDelegateTurnContextMessages,
  getDelegateKind,
} from '../utils/delegate-turn.js';
import {
  buildCacheableSystem,
  buildStableWakeContext,
  buildWakeContextMessages,
  loadCultureForSystemPrompt,
} from '../utils/system-prompt-builder.js';
import { buildThreadStateBlock } from '../utils/thread-state.js';
import { selectPromptContextMessages } from '../utils/prompt-context.js';
import { buildPromptMessages } from '../utils/prompt-assembly.js';
import { isMirrorFragileModel } from './mirror-guard.js';
import { isWakeContextMessage } from '../utils/to-model-messages.js';
import { buildSystemMessage } from './message-factory.js';

export interface RunContextInput {
  organizationId: string;
  agentId: string;
  threadId: string;
  channelId?: string;
  runId: string;
  model: LanguageModel;
  team: AgentTeamHandle;
  repo: ApiRepository;
  baseSystemPrompt: string;
  sourceMessage: Message | null;
  wakeReason?: WakeReason | null;
  summary?: string;
  systemPromptSuffix?: string;
  extraPrompt?: string;
  toolDefs: ToolSet;
  mcpServers: McpServerSummary[];
  threadMessages: Message[];
}

export interface RunContext {
  system: string;
  messages: ModelMessage[];
  debugLogger: AgentLoopLogger;
  promptHistoryMessages: Message[];
  contextMessages: ModelMessage[];
  wakeReplyPolicy: WakeReplyPolicy;
  isDelegateTurn: boolean;
}

export function visibleHistoryRunSteps(input: {
  repo: ApiRepository;
  organizationId: string;
  historyMessages: readonly Message[];
  currentRunId: string;
}): RunStep[] {
  const seen = new Set<string>();
  const runIds = new Set<string>();
  const steps: RunStep[] = [];
  for (const message of input.historyMessages) {
    const runId = message.metadata?.runId;
    if (!runId || runId === input.currentRunId) continue;
    runIds.add(runId);
  }
  for (const runId of runIds) {
    for (const step of input.repo.listRunSteps(input.organizationId, runId)) {
      if (seen.has(step.toolCallId)) continue;
      seen.add(step.toolCallId);
      steps.push(step);
    }
  }
  return steps;
}

export async function buildRunContext(input: RunContextInput): Promise<RunContext> {
  const {
    organizationId, agentId, threadId, channelId, runId,
    model, team, repo, baseSystemPrompt,
    sourceMessage, wakeReason, summary,
    systemPromptSuffix, extraPrompt,
    toolDefs, threadMessages,
  } = input;

  const availableToolIds = Object.keys(toolDefs);
  const isDelegateTurn = isDelegateMessage(sourceMessage);

  const dmPeerIsAgent = channelId
    ? ((mid: string) => repo.getMember(organizationId, mid)?.kind === AGENT_KIND)
    : (() => false);

  const wakeReplyPolicy = resolveWakeReplyPolicy({
    threadId,
    wakeReason,
    dmPeerIsAgent: isDelegateTurn
      ? false
      : dmPeerIsAgent(agentId),
  });

  const culture = await loadCultureForSystemPrompt({
    workspaceRoot: team.workspace.root,
    organizationId,
    memberId: agentId,
    channelId,
  });
  if (culture.applied.length > 0) {
    repo.recordProceduresApplied?.({ organizationId, runId, applied: culture.applied });
  }

  const { system } = buildCacheableSystem({
    baseSystem: baseSystemPrompt,
    lawText: culture.lawText,
    proceduresText: culture.cultureText,
    baseScaffold: wakeReplyPolicy.scaffoldBlock,
    availableToolIds,
  });

  const promptHistoryMessages = selectPromptContextMessages(
    sourceMessage
      ? threadMessages.filter((m) => m.id !== sourceMessage.id)
      : threadMessages,
  );

  const contextMessages: ModelMessage[] = [
    ...(summary ? [{ role: 'user' as const, content: summary }] : []),
    ...(systemPromptSuffix ? [{ role: 'user' as const, content: systemPromptSuffix }] : []),
    ...(extraPrompt ? [{ role: 'user' as const, content: extraPrompt }] : []),
  ];

  const chan = channelId ? repo.getChannel(organizationId, channelId) : undefined;

  const threadStateBlock = buildThreadStateBlock({
    messages: threadMessages,
    currentMember: { id: agentId, name: '' },
    sourceMessageId: sourceMessage?.id,
    threadId,
    members: repo.listMembers(organizationId),
    wakeReason: wakeReason ?? null,
    channelName: chan?.name,
  });
  if (threadStateBlock) {
    contextMessages.push({ role: 'user', content: threadStateBlock });
  }

  const resolvedModelId = (model as { modelId?: unknown }).modelId;
  const modelIdString = typeof resolvedModelId === 'string' ? resolvedModelId : '';
  const isFragile = isMirrorFragileModel(modelIdString);
  const wakeCtxInput = { wakeReason: wakeReason ?? null, modelIdString, isMirrorFragile: isFragile };

  const existingWakeCtx = threadMessages.find(isWakeContextMessage);
  if (!existingWakeCtx) {
    try {
      const stableCtx = buildStableWakeContext(wakeCtxInput);
      const systemMsg = buildSystemMessage({
        organizationId,
        threadId,
        content: stableCtx,
        metadata: { wakeContext: true },
        createdAt: new Date(0).toISOString(),
      });
      repo.saveMessage(systemMsg);
    } catch { /* non-critical */ }
  }

  const wakeContextMessages = buildWakeContextMessages(wakeCtxInput);
  contextMessages.push(...wakeContextMessages);

  if (isDelegateTurn && sourceMessage) {
    contextMessages.push(...buildDelegateTurnContextMessages(getDelegateKind(sourceMessage)));
  }

  const runSteps = [
    ...visibleHistoryRunSteps({ repo, organizationId, historyMessages: promptHistoryMessages, currentRunId: runId }),
    ...(repo.listRunSteps?.(organizationId, runId) ?? []),
  ];
  const messages = buildPromptMessages({
    historyMessages: promptHistoryMessages,
    currentMemberId: agentId,
    runSteps,
    contextMessages,
    currentRequestMessage: sourceMessage,
    currentRequest: sourceMessage
      ? undefined
      : { role: 'user', content: extraPrompt ?? 'Continue the task.' },
  });

  const debugLogger = new AgentLoopLogger();
  debugLogger.setContext({
    agentId,
    threadId,
    channelId,
    organizationId,
    model,
    systemPrompt: system,
    messages,
    tools: toolDefs,
  });

  return {
    system,
    messages,
    debugLogger,
    promptHistoryMessages,
    contextMessages,
    wakeReplyPolicy,
    isDelegateTurn,
  };
}
