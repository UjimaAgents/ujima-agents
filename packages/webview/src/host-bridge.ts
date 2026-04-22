import { useEffect, useState } from 'react';
import {
  appendEvents,
  emptyGovernancePolicy,
  HostToWebviewMessage,
  type ActivityEvent,
  type AgentPermissions,
  type AuditRecord,
  type GovernancePolicy,
  type PendingGate,
  type RateSample,
  type SessionSummary,
  type ToolCatalogEntry,
  type WebviewToHostMessage,
} from '@ujima/shared';

interface VSCodeApi {
  postMessage(msg: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VSCodeApi;
    __UJIMA_VIEW__?: 'activity' | 'governance';
  }
}

let cachedApi: VSCodeApi | undefined;
function getApi(): VSCodeApi | undefined {
  if (cachedApi) return cachedApi;
  if (typeof window !== 'undefined' && window.acquireVsCodeApi) {
    cachedApi = window.acquireVsCodeApi();
    return cachedApi;
  }
  return undefined;
}

export function postToHost(msg: WebviewToHostMessage): void {
  getApi()?.postMessage(msg);
}

const MAX_BUFFERED_EVENTS = 500;
const MAX_AUDIT_RECORDS = 2_000;

export function useHostEvents(): ActivityEvent[] {
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent): void => {
      const parsed = HostToWebviewMessage.safeParse(ev.data);
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.type === 'events.appended') {
        const incoming = msg.payload.events;
        setEvents((prev) => appendEvents(prev, incoming, { max: MAX_BUFFERED_EVENTS }));
      }
    };
    window.addEventListener('message', onMessage);
    postToHost({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return events;
}

export interface GovernanceAgentView {
  id: string;
  name: string;
  mcp: string;
  status: 'idle' | 'active' | 'waiting' | 'blocked' | 'killed' | 'exited';
  lastAction?: string;
  tokensUsed: number;
  tokenCap: number;
  permissions?: AgentPermissions;
}

export interface GovernanceSnapshot {
  sessionId: string;
  agents: GovernanceAgentView[];
  audit: AuditRecord[];
  rate: Map<string, RateSample[]>;
  sessions: SessionSummary[];
  policy: GovernancePolicy;
  catalog: ToolCatalogEntry[];
  pendingGates: PendingGate[];
}

const EMPTY_SNAPSHOT: GovernanceSnapshot = {
  sessionId: '',
  agents: [],
  audit: [],
  rate: new Map(),
  sessions: [],
  policy: emptyGovernancePolicy(),
  catalog: [],
  pendingGates: [],
};

export function useGovernanceSnapshot(): GovernanceSnapshot {
  const [snap, setSnap] = useState<GovernanceSnapshot>(EMPTY_SNAPSHOT);

  useEffect(() => {
    const onMessage = (ev: MessageEvent): void => {
      const parsed = HostToWebviewMessage.safeParse(ev.data);
      if (!parsed.success) return;
      const msg = parsed.data;

      if (msg.type === 'governance.snapshot') {
        const rate = new Map<string, RateSample[]>();
        for (const r of msg.payload.rate) rate.set(r.agentId, r.samples);
        setSnap((prev) => ({
          ...prev,
          sessionId: msg.payload.session_id,
          agents: msg.payload.agents,
          audit: msg.payload.audit,
          rate,
          sessions: msg.payload.sessions,
        }));
        return;
      }

      if (msg.type === 'audit.appended') {
        const records = msg.payload.records;
        setSnap((prev) => ({
          ...prev,
          audit: trimAudit([...prev.audit, ...records]),
        }));
        return;
      }

      if (msg.type === 'rate.updated') {
        const { agentId, samples } = msg.payload;
        setSnap((prev) => {
          const nextRate = new Map(prev.rate);
          nextRate.set(agentId, samples);
          return { ...prev, rate: nextRate };
        });
        return;
      }

      if (msg.type === 'sessions.updated') {
        const sessions = msg.payload.sessions;
        setSnap((prev) => ({ ...prev, sessions }));
        return;
      }

      if (msg.type === 'agents.updated') {
        const agents = msg.payload.agents;
        setSnap((prev) => ({ ...prev, agents }));
        return;
      }

      if (msg.type === 'governance.policy.snapshot') {
        const { policy, catalog } = msg.payload;
        setSnap((prev) => ({ ...prev, policy, catalog }));
        return;
      }

      if (msg.type === 'governance.gates.snapshot') {
        const pending = msg.payload.pending;
        setSnap((prev) => ({ ...prev, pendingGates: pending }));
        return;
      }

      if (msg.type === 'governance.gates.added') {
        const gate = msg.payload.gate;
        setSnap((prev) => {
          if (prev.pendingGates.some((g) => g.id === gate.id)) return prev;
          return { ...prev, pendingGates: [...prev.pendingGates, gate] };
        });
        return;
      }

      if (msg.type === 'governance.gates.resolved') {
        const { id } = msg.payload;
        setSnap((prev) => ({
          ...prev,
          pendingGates: prev.pendingGates.filter((g) => g.id !== id),
        }));
        return;
      }
    };
    window.addEventListener('message', onMessage);
    postToHost({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return snap;
}

function trimAudit(records: AuditRecord[]): AuditRecord[] {
  if (records.length <= MAX_AUDIT_RECORDS) return records;
  return records.slice(records.length - MAX_AUDIT_RECORDS);
}
