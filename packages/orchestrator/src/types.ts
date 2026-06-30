import type { AgentDef, TaskDef, TeamDef, UjimaEvent } from '@ujima/shared';
import type {
  AgentStateStore,
  ApprovalTracker,
  AuditLog,
  ContextStore,
  TaskStateStore,
} from '@ujima/context-store';
import type { EventBus } from '@ujima/event-bus';
import type { PermissionMiddleware } from '@ujima/permissions';
import type { MCPConnection } from '@ujima/mcp-client';
import type { LanguageModel } from 'ai';
import type { AgentRunResult, GateResolver } from '@ujima/agent-runtime';

export interface OrchestratorDeps {
  resolveAgent: (agentId: string) => Promise<AgentDef | undefined> | AgentDef | undefined;
  getMCPConnection: (
    mcpId: string,
    opts?: { agentId?: string; scopePaths?: string[] },
  ) => Promise<MCPConnection> | MCPConnection;
  getModel: (agent: AgentDef) => LanguageModel;
  eventBus: EventBus;
  context: ContextStore;
  audit: AuditLog;
  permissions: PermissionMiddleware;
  agentState: AgentStateStore;
  approvals: ApprovalTracker;
  taskState?: TaskStateStore;
  onStream?: (event: UjimaEvent) => void;
  gateResolver?: GateResolver;
}

export type TaskStatus = 'running' | 'completed' | 'paused' | 'failed';

export interface RunTaskInputs {
  task: TaskDef;
  team: TeamDef;
  sessionId: string;
  sequence?: string[];
}

export interface RunTaskResult {
  taskId: string;
  sessionId: string;
  status: TaskStatus;
  agentResults: AgentRunResult[];
  approvalsPending: number;
  output: TaskSynthesis;
  error?: string;
}

export interface TaskSynthesis {
  summary: string;
  agents: {
    agentId: string;
    exitReason: AgentRunResult['exitReason'];
    finalText: string;
    outputKey: string;
  }[];
  pendingApprovals: {
    id: string;
    agentId: string;
    artifactKey: string;
    domain: string;
  }[];
}

export interface SessionHandle {
  sessionId: string;
  taskId: string;
  result: Promise<RunTaskResult>;
  killAgent(agentId: string): void;
  killSession(): void;
  agentIds(): string[];
}

export const ORCHESTRATOR_EVENT_CHANNEL = 'orchestrator:events';

export type OrchestratorEventType =
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'approval_requested';

export type OrchestratorEvent = UjimaEvent<{
  kind: OrchestratorEventType;
  [key: string]: unknown;
}>;
