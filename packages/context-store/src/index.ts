import { openDatabase, type DbHandle } from './db';

export type SqliteDbHandle = DbHandle;
import { createContextStore, type ContextStore } from './context';
import { createAuditLog, type AuditLog } from './audit';
import { createApprovalTracker, type ApprovalTracker } from './approvals';
import {
  createAgentStateStore,
  createTaskStateStore,
  type AgentStateStore,
  type TaskStateStore,
} from './state';
import { createPendingEventStore, type PendingEventStore } from './pending-events';

export type { ContextStore, ContextEntry } from './context';
export type { AuditLog, AuditQuery, AuditWriteInput, AuditEventType } from './audit';
export type { ApprovalTracker, ApprovalRecord, ApprovalStatus } from './approvals';
export type {
  AgentStateStore,
  TaskStateStore,
  AgentStateRecord,
  TaskStateRecord,
  AgentStatus,
  TaskStatus,
} from './state';
export type { PendingEventStore, PendingEventRecord } from './pending-events';
export { nowMs, openDatabase } from './db';

export interface UjimaDb {
  context: ContextStore;
  audit: AuditLog;
  approvals: ApprovalTracker;
  agentState: AgentStateStore;
  taskState: TaskStateStore;
  pendingEvents: PendingEventStore;
  raw: DbHandle;
  close(): Promise<void>;
}

export interface OpenDbOptions {
  dbPath: string;
  pollingIntervalMs?: number;
}

export function openDb(options: OpenDbOptions): UjimaDb {
  const db = openDatabase({ dbPath: options.dbPath });
  const context = createContextStore({ db, pollingIntervalMs: options.pollingIntervalMs });
  const audit = createAuditLog(db);
  const approvals = createApprovalTracker(db);
  const agentState = createAgentStateStore(db);
  const taskState = createTaskStateStore(db);
  const pendingEvents = createPendingEventStore(db);

  return {
    context,
    audit,
    approvals,
    agentState,
    taskState,
    pendingEvents,
    raw: db,
    async close() {
      context.__flush();
      db.close();
    },
  };
}

