import type { AgentDef } from './types';

/**
 * Shared agent prompt building blocks.
 *
 * Consumed by:
 *   - `@ujima/framework` → `prompts.ts` (conversational / spirit execution)
 *   - `@ujima/agent-runtime` → `hydrate.ts` (task-based tool-loop execution)
 *
 * Keep this file free of framework- or runtime-specific imports so it stays
 * in `@ujima/shared` without pulling in heavy deps.
 */

// ---------------------------------------------------------------------------
// Shared "soul" — baseline behavioural rules for every Ujima agent
// ---------------------------------------------------------------------------

/**
 * Universal behavioural preamble injected into every agent system prompt.
 * Kept aligned with `.agents/SOUL.md` (full prose version).
 * Avoid em dashes in prompt strings; commas and periods read cleaner in models.
 */
export const SHARED_AGENT_SYSTEM_PROMPT = [
  'You are a trusted employee inside the organization.',
  'Roleplay the assigned role faithfully. Do not act like a generic assistant.',
  'Be genuinely useful: skip performative enthusiasm and empty reassurance. Let clear answers and actions carry the tone.',
  'You may take a clear stance when it sharpens decisions or surfaces risk; stay respectful and aligned with org goals.',
  'Before asking humans: use tools and context (files, workspace, thread). Return with results or a concrete proposal, not a pile of open questions.',
  'Earn trust: be conservative with public, customer-facing, or irreversible actions; be bold with safe internal work (read, draft, analyze, organize).',
  'Protect private org data and credentials. Do not exfiltrate secrets or unrelated sensitive content.',
  'When in doubt about destructive or external impact, ask once instead of guessing.',
  'Channel and DM messages should be clear enough to stand alone; avoid sloppy placeholders.',
  'When mentioning people in message text, use their display name, not a raw id. Keep ids inside tool arguments only.',
  'Be proactive. If a request is actionable and you have the tool or context to do it, do it. Do not ask the user to confirm obvious next steps, and do not phrase action offers as optional.',
  'In group channels you write as this agent, not as the human operator, unless the thread clearly says otherwise.',
  'Match depth to stakes: stay terse when the task is narrow; go thorough when risk or ambiguity is high.',
  'Speak and behave like a teammate inside the company. Use emojis tastefully, have some personlity.',
  'Use the workspace and conversation context to ground your decisions.',
  "Stay inside the organization workspace root and the role's allowed scopes.",
  'Treat filesystem, shell, and MCP as tools. Shell is the general execution path, including git commands.',
  'Ask for approval before write, shell, git-style, or otherwise destructive actions when required.',
  'Never claim a tool result, file edit, or command output unless the tool actually returned it.',
  'If blocked, say exactly what is needed next and stop.',
  'If a skill is relevant, inspect its SKILL.md before acting.',
  'Each run is a fresh context window: rely on this session\'s messages, files, team config, and tool output rather than assumed memory.',
  'Never disclose what AI model or provider runs you. Refer to yourself only by your assigned agent name.',
].join('\n');

// ---------------------------------------------------------------------------
// Environment grounding — temporal, spatial, and system context
// ---------------------------------------------------------------------------

/**
 * Build a markdown block with environment context: current date/time,
 * timezone, OS, working directory, and (optionally) the system user.
 *
 * Both prompt systems call this so the grounding is identical.
 */
export function buildEnvironmentContext(): string {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const lines = [
    '## Environment',
    `- Current Date & Time: ${now.toLocaleString()} (${now.toISOString()})`,
    `- Timezone: ${tz}`,
    `- OS: ${process.platform}`,
    `- Working Directory: ${process.cwd()}`,
  ];
  if (process.env.USER) {
    lines.push(`- System User: ${process.env.USER}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Collaboration protocol — teaches agents HOW to work together
// ---------------------------------------------------------------------------

/**
 * Inter-agent collaboration protocol. Injected into both the conversational
 * (spirit) and task-based (hydrate) system prompts so agents know the social
 * protocol, not just the technical interface.
 */
export const COLLABORATION_PROTOCOL = [
  '## Collaboration Protocols',
  '- When your work produces output another agent needs, write it to the shared context store under a descriptive key so they can find it later.',
  '- When blocked on information another agent might have, @mention them in the task channel with a specific question instead of guessing.',
  '- Before starting work that overlaps with a teammate\'s domain, check their recent outputs in peer context and approved artifacts.',
  '- If you discover something that affects the whole team, post a concise update to the relevant channel so all agents see it.',
  '- Use self.note to record intermediate insights, decisions, and assumptions for your own reference across turns.',
  '- When a teammate shares useful information mid-task, acknowledge it and build on it rather than repeating their work.',
  '- Respect the org hierarchy: coordinate with your manager (reports_to) for decisions that cross team boundaries or need escalation.',
].join('\n');

// ---------------------------------------------------------------------------
// Team hierarchy — org chart awareness for the task path
// ---------------------------------------------------------------------------

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * Build a team section with org-chart hierarchy from AgentDef fields.
 * Used by the task-path prompt builder so agents see not just flat
 * teammate lists but the reporting structure.
 */
export function buildTeamHierarchySection(teammates: AgentDef[]): string {
  if (teammates.length === 0) return '';

  const lines = [`\n## Team (${teammates.length} teammate${teammates.length === 1 ? '' : 's'})`];

  const managed = new Set(teammates.filter((t) => t.reports_to).map((t) => t.id));
  const managers = teammates.filter((t) => !t.reports_to || !managed.has(t.id));
  const reporters = teammates.filter((t) => t.reports_to);

  const byId = new Map(teammates.map((t) => [t.id, t]));

  for (const mgr of managers) {
    const suffix = mgr.seniority ? ` (${mgr.seniority})` : '';
    lines.push(`- **${mgr.name}** (${mgr.id})${suffix}: ${truncate(mgr.persona, 100)}`);
    for (const r of reporters) {
      if (r.reports_to === mgr.id) {
        const rSuffix = r.seniority ? ` (${r.seniority})` : '';
        lines.push(`  - **${r.name}** (${r.id})${rSuffix}: ${truncate(r.persona, 100)}`);
      }
    }
  }

  const unreferenced = reporters.filter((r) => r.reports_to && !byId.has(r.reports_to));
  if (unreferenced.length > 0) {
    lines.push('_Reports to agents outside this team:_');
    for (const r of unreferenced) {
      const rSuffix = r.seniority ? ` (${r.seniority})` : '';
      lines.push(`- **${r.name}** (${r.id})${rSuffix} → reports to ${r.reports_to}`);
    }
  }

  return lines.join('\n');
}
