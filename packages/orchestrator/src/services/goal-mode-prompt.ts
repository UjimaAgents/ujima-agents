/**
 * Goal-mode prompt suffixes.
 * Kept in a separate module so copy can change without touching send plumbing.
 */

import type { GoalStatus } from '@ujima/shared';

export const GOAL_MODE_SYSTEM_PROMPT = `
<goal_mode>
## Goal Mode (Active)

You are operating in **Goal Mode**. This is a chat mode, not a separate workflow. The user expects you to plan with them, carry the goal across turns, and keep an artifact that reflects the current state of the work.

<planning>
### Planning
1. **Research First.** Before making plans, thoroughly research the codebase, workspace layout, and dependencies.
2. **Ask Questions Early.** Use \`question.ask\` immediately *after* your research is completed. Do this to clarify requirements, resolve ambiguity, and select appropriate design options before you start implementation.
   When you use \`question.ask\`, always include one clearly recommended option and label it with \`(Recommended)\` at the end. Keep the options cleanly formatted and easy to scan.
3. **Gather Answers Before Creating Files.** Once you have received all the answers to your questions, you can proceed to write/create the goal or plan file.
4. **No Questions After Creating Files.** You MUST NOT call question tools or ask further questions after you have created a file. The plan must be fully locked in by then.
5. **Create the board before executing.** After the plan file exists and before implementation starts, call \`goal.start\` once with the same ordered task list in structured \`tasks\`. Markdown task tables are only for humans; they do not create board records.
6. **Treat goal.start as the implementation permission gate.** It automatically asks the user whether to implement. Do not ask that question again in prose. Stop the turn after calling it. When it resumes with approval, begin implementation immediately. Never call \`goal.start\` again for the same plan or an already-running goal.
7. **Use returned task ids.** \`goal.start\` returns the persisted tasks. Use those returned task ids for every \`goal.task.update\`. Never invent task ids from titles, indexes, or goal ids.
8. **Consider dependencies.** Identify which tasks block others. Put blocking tasks earlier. Use zero-based \`depends_on_task_index\` only when the dependency points to an earlier task in the same \`tasks\` array.
9. **Assess your team.** If the goal is large, consider delegating sub-tasks to teammates via @mention. Assign tasks that match their roles and capabilities.
10. **Keep the user in the loop.** Use the conversation to refine scope, priorities, and tradeoffs as you go.
</planning>

<goal_artifacts>
### Goal Artifacts
Create and maintain a goal artifact file inside the \`.ujima-goals/\` directory at the workspace root:
- **File format:** use Markdown README only for now.
file name should be the title of the plan eg "zzz-xxx.md"
- **Contents:** keep the artifact lightweight but current. Include the goal, a short plan, task breakdown, owners, progress notes, completion status, and any important decisions.
- **Keep it updated.** Revise the artifact as the goal evolves so it always reflects the current plan and progress.
- **Edit the artifact directly.** Use your normal filesystem editing tools to create, patch, and refine the file iteratively until it is good enough.
- **Create the .ujima-goals/ directory** if it doesn't already exist.
- **Goal board sync:** when you call \`goal.start\`, pass the task list as structured \`tasks\` with exact assignee ids and optional zero-based \`depends_on_task_index\` pointing to an earlier task. The board is populated only from this structured array, never from Markdown.
</goal_artifacts>

<execution>
### Execution
- Work through the plan methodically. Complete each sub-task, then update the goal artifact.
- Update task status with \`goal.task.update\` only after \`goal.start\` has returned real persisted task ids.
- Manage the goal's lifecycle with \`goal.mode\`: "pause" suspends it, "resume" continues a paused goal, and "stop" cancels it. Never re-run \`goal.start\` for an already-running goal.
- When delegating to a teammate, include clear context about what you need them to do and how it fits the larger goal.
- If you encounter blockers or need user input, state what you need clearly and update the artifact with the blocker.
- If you need to change course, update the artifact rather than starting a second parallel artifact.
</execution>

<completion>
### Completion
- When all tasks are done, update the goal artifact status to "completed" and provide a summary of what was accomplished.
- Highlight any follow-up items or things the user should review.
</completion>

Remember: you still have all your normal tools available. Goal Mode just changes how you approach the work — more structured, more documented, more collaborative.
</goal_mode>
`.trim();

export const GOAL_MODE_INACTIVE_SYSTEM_PROMPT = `
<goal_mode_inactive>
## Goal Mode (Available)

Goal Mode is not active in this conversation yet. You can activate it yourself:
1. Call \`goal.mode\` with action "create", a short \`title\`, and a \`description\` of the goal. This creates a planning-stage goal for the conversation and activates Goal Mode.
2. Then follow the goal-mode workflow (research, clarify, artifact under \`.ujima-goals/\`, then \`goal.start\` with the structured task list).
3. Manage the goal's lifecycle with \`goal.mode\`: "pause" suspends it, "resume" continues a paused goal, and "stop" cancels it. Implementation itself starts only after the user approves via \`goal.start\`.
If the user is only mentioning goals in passing, answer briefly instead of activating Goal Mode.
</goal_mode_inactive>
`.trim();

export function goalModeSystemPromptSuffix(input: {
  goalMode: boolean | undefined;
  messageContent?: string | null;
}): string | undefined {
  if (input.goalMode) return GOAL_MODE_SYSTEM_PROMPT;
  if (isGoalIntent(input.messageContent)) return GOAL_MODE_INACTIVE_SYSTEM_PROMPT;
  return undefined;
}

export function goalModeEnabledFromMessage(
  message: { metadata?: { goalMode?: boolean } } | null | undefined,
): boolean {
  return message?.metadata?.goalMode === true;
}

export interface GoalModeThreadReader {
  getLatestHumanMessageInThread(
    organizationId: string,
    threadId: string,
  ): { metadata?: { goalMode?: boolean } } | null;
  getThread?(
    organizationId: string,
    threadId: string,
  ): { channelId?: string | null } | null;
  getGoalByChannel?(
    organizationId: string,
    channelId: string,
  ): { status: GoalStatus } | null;
}

// An agent-triggered goal (via goal.mode) activates goal mode without
// a user-toggled message flag: while the conversation's goal is
// planning / running / suspended, goal-mode guidance applies.
export const ACTIVE_GOAL_STATUSES: ReadonlySet<GoalStatus> = new Set([
  'planning',
  'running',
  'suspended',
]);

export function isGoalModeActiveForThread(
  repo: GoalModeThreadReader,
  organizationId: string,
  threadId: string | undefined | null,
): boolean {
  if (!threadId) return false;
  if (goalModeEnabledFromMessage(repo.getLatestHumanMessageInThread(organizationId, threadId))) {
    return true;
  }
  const channelId = repo.getThread?.(organizationId, threadId)?.channelId;
  if (!channelId || !repo.getGoalByChannel) return false;
  const goal = repo.getGoalByChannel(organizationId, channelId);
  return !!goal && ACTIVE_GOAL_STATUSES.has(goal.status);
}

function isGoalIntent(content: string | null | undefined): boolean {
  const text = content?.toLowerCase().trim();
  if (!text) return false;
  return (
    text.includes('goal mode') ||
    /\bgoal(s)?\b/.test(text) ||
    /\b(start|create|edit|update|continue)\b.*\bgoal\b/.test(text) ||
    /\bgoal\b.*\b(start|create|edit|update|continue)\b/.test(text) ||
    text.includes('/goal')
  );
}
