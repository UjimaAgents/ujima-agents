export { runAgent } from './shell';
export type { AgentHandle } from './shell';

export { hydrate } from './hydrate';
export type { HydrateDeps } from './hydrate';

export { captureBrowserState } from './browser';
export type { BrowserStateSnapshot } from './browser';

export { runAiSdkLoop } from './ai-sdk-loop';
export type { AiSdkLoopInputs, AiSdkLoopOutcome } from './ai-sdk-loop';

export { createLanguageModelFromLegacyProvider } from './legacy-llm-language-model';

export type { OrchestratorEngine } from './engine';
export { ORCHESTRATOR_ENGINES, resolveOrchestratorEngine } from './engine';

export { matchesEscalation } from './escalation';
export type { EscalationMatch } from './escalation';

export { runConcurrent } from './concurrent';
export type { ConcurrentRunInputs, ConcurrentRunHandle } from './concurrent';

export { createAgentWatchdog } from './watchdog';
export type { AgentWatchdog, WatchdogOptions } from './watchdog';

export { spawnAgentProcess } from './spawn';
export type { SpawnProcessOptions, AgentProcessHandle } from './spawn';
export { runInRunner } from './runner';
export type { RunnerConfig } from './runner';

export type {
  AgentRunInputs,
  AgentRunResult,
  HydrationBundle,
  SpawnReason,
  ExitReason,
  GateRequest,
  GateDecision,
  GateResolver,
} from './types';
