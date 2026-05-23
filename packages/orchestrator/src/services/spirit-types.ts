import type { LanguageModel } from 'ai';
import type {
  MCPDef,
  Message,
  RunState,
  RunStep,
  Spirit,
  SpiritRole,
  WakeReason,
} from '@ujima/shared';
import type { ActiveSpiritRegistry } from './active-spirit-registry.js';
import type { ConversationService } from './conversation.js';
import type { AiService } from '../ai-service.js';
import type { McpRuntimePool } from './mcp-runtime.js';
import type { ApiRepository } from './repository-reader.js';

export interface ModelResolverInput {
  organizationId: string;
  memberId: string;
  role: SpiritRole;
}

export type ModelResolver = (input: ModelResolverInput) => LanguageModel | Promise<LanguageModel>;

export interface SpiritServiceOptions {
  maxIterationsPerRun?: number;
  maxOutputTokens?: number;
  temperature?: number;
  modelResolver?: ModelResolver;
  registry?: ActiveSpiritRegistry;
  conversations?: ConversationService;
  ai?: AiService;
  mcpPool?: SpiritMcpPool;
  mcpResolver?: SpiritMcpResolver;
  supervisorDebounceMs?: number;
  supervisorTurnCapPerSession?: number;
}

export type SpiritMcpPool = McpRuntimePool;

export type SpiritMcpResolver = (input: {
  organizationId: string;
  memberId: string;
  role: SpiritRole;
}) => Promise<SpiritMcpResolution[]>;

export interface SpiritMcpResolution {
  def: MCPDef;
  serverId: string;
  serverName: string;
}

export interface SpawnSpiritInput {
  organizationId: string;
  taskSessionId: string;
  memberId: string;
  role?: SpiritRole;
}

export interface CreateRunInput {
  organizationId: string;
  agentId: string;
  threadId: string;
  summary?: string;
  wakeReason?: WakeReason;
  sourceMessageId?: string;
  byMemberId?: string;
}

export interface RunSpiritInput {
  organizationId: string;
  taskSessionId: string;
  memberId: string;
  extraPrompt?: string;
  systemPromptSuffix?: string;
  maxIterations?: number;
  toolAllowlist?: readonly string[];
  role?: SpiritRole;
}

export interface RunSpiritOutcome {
  spirit: Spirit;
  finalText: string;
  iterations: number;
  toolCalls: number;
  tokensUsed: number;
  /** Publishing/pass terminators; null when the run ended without one. */
  terminatingTool: string | null;
}

export interface RunDetailAggregate {
  count: number;
  pending: number;
}

export interface RunTraceDetail {
  run: RunState;
  approvals: ReturnType<ApiRepository['listPendingApprovals']>;
  messages: Message[];
  steps: RunStep[];
  message?: Message;
}

export interface RunDetail {
  run: RunState;
  approvals: ReturnType<ApiRepository['listPendingApprovals']>;
  messages: ReturnType<ApiRepository['listMessages']>['data'];
  steps: RunStep[];
  message?: Message;
  activeAgents: { memberId: string; statusLabel: string }[];
  tokens: { perMemberId: Record<string, number> };
  tools: Record<string, RunDetailAggregate>;
}

export interface SpiritAlertInput {
  organizationId: string;
  memberId: string;
  channelId?: string;
  messageId: string;
  threadId: string;
  byMemberId: string;
  reason: string;
  wakeReason?: WakeReason;
}

export interface SpiritSupervisorReplyOutcome {
  taskSessionId: string;
  message: Message | null;
  fallback: boolean;
  reason: string;
}

export type SpiritAlertDispatchResult =
  | { kind: 'replied'; outcome: SpiritSupervisorReplyOutcome }
  | { kind: 'no-active-spirit' }
  | { kind: 'debounced' };
