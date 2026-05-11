/**
 * Orchestrator engine.
 *
 * - `ai-sdk` — {@link runAiSdkLoop} via Vercel AI SDK (the only engine).
 */
export const ORCHESTRATOR_ENGINES = ['ai-sdk'] as const;
export type OrchestratorEngine = (typeof ORCHESTRATOR_ENGINES)[number];

const DEFAULT_ENGINE: OrchestratorEngine = 'ai-sdk';

export function resolveOrchestratorEngine(input: string | undefined): OrchestratorEngine {
  const trimmed = input?.trim();
  if (trimmed === undefined || trimmed === '') {
    return DEFAULT_ENGINE;
  }
  if (trimmed === 'ai-sdk') {
    return trimmed;
  }
  throw new Error(`Invalid orchestrator engine: ${input}. Only 'ai-sdk' is supported.`);
}
