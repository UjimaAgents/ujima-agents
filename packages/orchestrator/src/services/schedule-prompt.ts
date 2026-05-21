const SCHEDULE_INTENT_PREFIX = 'please use the schedule tool for this request:';

export const SCHEDULE_TOOL_SYSTEM_PROMPT = `
## Schedule Request

The user wants a schedule created or managed. Use the schedule tool directly.
If the request is missing a cron expression or other schedule details, ask one short follow-up question instead of improvising.
Do not answer as if the schedule already exists.
`.trim();

export function scheduleToolSystemPromptSuffix(input: {
  messageContent?: string | null;
}): string | undefined {
  const text = input.messageContent?.trim().toLowerCase();
  if (!text) return undefined;
  if (text.startsWith(SCHEDULE_INTENT_PREFIX)) return SCHEDULE_TOOL_SYSTEM_PROMPT;
  if (text === '/schedule' || text.startsWith('/schedule ')) return SCHEDULE_TOOL_SYSTEM_PROMPT;
  return undefined;
}
