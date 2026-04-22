import type { AgentRunInputs, AgentRunResult } from './types';
import { runAgent, type AgentHandle } from './shell';

export interface ConcurrentRunInputs {
  members: AgentRunInputs[];
  sessionAbortSignal?: AbortSignal;
}

export interface ConcurrentRunHandle {
  handles: AgentHandle[];
  results: Promise<AgentRunResult[]>;
  killAll(): void;
}

export function runConcurrent(input: ConcurrentRunInputs): ConcurrentRunHandle {
  const sessionController = new AbortController();
  if (input.sessionAbortSignal) {
    if (input.sessionAbortSignal.aborted) sessionController.abort();
    else input.sessionAbortSignal.addEventListener('abort', () => sessionController.abort(), { once: true });
  }

  const handles = input.members.map((member) => {
    const agentController = new AbortController();
    sessionController.signal.addEventListener('abort', () => agentController.abort(), { once: true });
    const existing = member.abortSignal;
    if (existing) {
      if (existing.aborted) agentController.abort();
      else existing.addEventListener('abort', () => agentController.abort(), { once: true });
    }
    return runAgent({ ...member, abortSignal: agentController.signal });
  });

  const results = Promise.all(handles.map((h) => h.result));

  return {
    handles,
    results,
    killAll: () => sessionController.abort(),
  };
}
