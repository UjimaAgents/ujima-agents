/**
 * Which orchestrator engine drives a given run.
 *
 * - `ai-sdk` (default post-E0) — {@link runAiSdkLoop} via Vercel AI SDK.
 * - `legacy` — {@link runToolLoop} via the hand-rolled `@ujima/llm/legacy`
 *   provider clients. Scheduled for deletion two clean releases after cutover.
 */
export const ORCHESTRATOR_ENGINES = ['ai-sdk'] as const;
export type OrchestratorEngine = (typeof ORCHESTRATOR_ENGINES)[number];

const DEFAULT_ENGINE: OrchestratorEngine = 'ai-sdk';

export function resolveOrchestratorEngine(
  input: string | undefined,
): OrchestratorEngine {
  return DEFAULT_ENGINE;
}
