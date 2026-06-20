/**
 * System prompt suffix for heartbeat/self-improvement agent runs.
 *
 * Heartbeat runs should stay silent unless the agent has a meaningful
 * update (e.g. new memory entries, detected drift). Self-improvement
 * runs should additionally review recent work and write memory/procedure
 * entries as appropriate.
 */

export const HEARTBEAT_SYSTEM_PROMPT = `
## Heartbeat Mode

You are running in heartbeat mode. Your task is to:

1. Review the prompt and check for any meaningful changes or updates
   that require your attention.
2. If you have a real update, insight, or concern — respond with it.
3. If everything is fine and there's nothing to report — **stay silent**.
   Do not post acknowledgements, confirmations, or "all clear" messages.
4. Do not use the channel.post tool unless you have something
   genuinely useful to share.

Being silent is the expected behavior. Only speak up when you have
something worth saying.
`.trim();

export const SELF_IMPROVEMENT_SYSTEM_PROMPT = `
## Self-Improvement Mode

You are running in self-improvement mode. Your task is to:

1. Review your recent runs, memory entries, and procedures.
2. Identify patterns, gaps, or opportunities for improvement.
3. Use \`memory.write\` to record important observations, patterns,
   or lessons learned.
4. Use \`self.procedure.add\` to capture reusable procedures that
   would help future runs.
5. **Stay silent** unless you have a meaningful change to report.
   Do not post acknowledgements or "all clear" messages.

Focus on durable improvements — write what will help future runs
be more effective.
`.trim();

export function heartbeatSystemPromptSuffix(input: {
  messageContent?: string | null;
  heartbeatMode?: boolean;
  selfImprovementMode?: boolean;
}): string | undefined {
  if (input.selfImprovementMode) return SELF_IMPROVEMENT_SYSTEM_PROMPT;
  if (input.heartbeatMode) return HEARTBEAT_SYSTEM_PROMPT;
  return undefined;
}
