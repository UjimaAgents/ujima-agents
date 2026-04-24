/**
 * Which orchestrator engine drives a given run.
 *
 * - `ai-sdk` (default post-E0) — {@link runAiSdkLoop} via Vercel AI SDK.
 * - `legacy` — {@link runToolLoop} via the hand-rolled `@ujima/llm/legacy`
 *   provider clients. Scheduled for deletion two clean releases after cutover.
 */
export const ORCHESTRATOR_ENGINES = ['ai-sdk', 'legacy'] as const;
export type OrchestratorEngine = (typeof ORCHESTRATOR_ENGINES)[number];

const DEFAULT_ENGINE: OrchestratorEngine = 'ai-sdk';

export function resolveOrchestratorEngine(
  input: string | undefined,
): OrchestratorEngine {
  if (!input) return DEFAULT_ENGINE;
  if ((ORCHESTRATOR_ENGINES as readonly string[]).includes(input)) {
    return input as OrchestratorEngine;
  }
  throw new Error(
    `Invalid orchestrator engine "${input}". Expected one of: ${ORCHESTRATOR_ENGINES.join(', ')}`,
  );
}
