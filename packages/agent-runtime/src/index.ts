export { runAgent } from './shell';
export type { AgentHandle } from './shell';

export { hydrate } from './hydrate';
export type { HydrateDeps } from './hydrate';

export { captureBrowserState } from './browser';
export type { BrowserStateSnapshot } from './browser';

export { runAiSdkLoop } from './ai-sdk-loop';
export type { AiSdkLoopInputs, AiSdkLoopOutcome } from './ai-sdk-loop';

export { runAgentLoopWithRetry, supportsTemperature, wrapToolFallback } from './loop-host';
export type { LoopRetryHooks } from './loop-host';

export { matchesEscalation } from './escalation';
export type { EscalationMatch } from './escalation';

export { runConcurrent } from './concurrent';
export type { ConcurrentRunInputs, ConcurrentRunHandle } from './concurrent';

export type {
  AgentRunInputs,
  AgentRunResult,
  GateResolver,
  HydrationBundle,
  SpawnReason,
  ExitReason,
} from './types';
