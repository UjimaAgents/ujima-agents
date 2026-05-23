import type { AgentDef, TaskDef, UjimaEvent } from '@ujima/shared';
import type { AuditLog, AgentStateStore, ApprovalTracker, ContextEntry, ContextStore, TaskStateStore } from '@ujima/context-store';
import type { EventBus } from '@ujima/event-bus';
import type { PermissionMiddleware, PermissionGate, PermissionDenyCode } from '@ujima/permissions';
import type { MCPConnection } from '@ujima/mcp-client';
import type { LanguageModel } from 'ai';
import { type BrowserStateSnapshot } from './browser';

export interface GateRequest {
  agentId: string;
  taskId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  mcpId: string;
  mcpName?: string;
  args: Record<string, unknown>;
  gate: PermissionGate;
  code: Extract<PermissionDenyCode, 'requires_approval' | 'requires_input'>;
  reason?: string;
  abortSignal?: AbortSignal;
}

export type GateDecision =
  | { kind: 'approve'; args?: Record<string, unknown>; reason?: string; decidedBy?: string }
  | { kind: 'reject'; reason?: string; decidedBy?: string };

export interface GateResolver {
  awaitDecision(request: GateRequest): Promise<GateDecision>;
}

export type SpawnReason = 'initial' | 'event_triggered' | 'human_resume';

export type ExitReason =
  | 'completed'
  | 'escalated'
  | 'token_cap_exceeded'
  | 'killed'
  | 'error';

export interface AgentRunInputs {
  agent: AgentDef;
  task: TaskDef;
  sessionId: string;
  spawnReason: SpawnReason;
  /** AI SDK LanguageModel used to run the agent loop. */
  model: LanguageModel;
  mcp: MCPConnection;
  permissions: PermissionMiddleware;
  eventBus: EventBus;
  context: ContextStore;
  audit: AuditLog;
  agentState: AgentStateStore;
  taskState?: TaskStateStore;
  approvals?: ApprovalTracker;
  hydration?: HydrationBundle;
  maxToolIterations?: number;
  abortSignal?: AbortSignal;
  heartbeatIntervalMs?: number;
  onEvent?: (event: UjimaEvent) => void;
  onStream?: (event: UjimaEvent) => void;
  gateResolver?: GateResolver;
}

export interface HydrationBundle {
  persona: string;
  taskPrompt: string;
  events: UjimaEvent[];
  approvedArtifacts: ContextEntry[];
  peerOutputs: ContextEntry[];
  systemPrompt: string;
}

export interface AgentRunResult {
  agentId: string;
  taskId: string;
  sessionId: string;
  exitReason: ExitReason;
  toolCalls: number;
  iterations: number;
  tokensUsed: number;
  finalText: string;
  escalationReason?: string;
  error?: string;
  browserState?: BrowserStateSnapshot;
}
