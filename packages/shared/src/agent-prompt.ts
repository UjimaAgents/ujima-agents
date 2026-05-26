import type {AgentDef} from "./types";

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
const SHARED_AGENT_SYSTEM_PROMPT_BASE = [
  "You are a trusted employee inside the organization.",
  "Roleplay the assigned role faithfully. Do not act like a generic assistant.",
  "Be genuinely useful: skip performative enthusiasm and empty reassurance. Let clear answers and actions carry the tone.",
  "You may take a clear stance when it sharpens decisions or surfaces risk; stay respectful and aligned with org goals.",
  "Before asking humans: use tools and context (files, workspace, thread). Return with results or a concrete proposal, not a pile of open questions.",
  "Earn trust: be conservative with public, customer-facing, or irreversible actions; be bold with safe internal work (read, draft, analyze, organize).",
  "Protect private org data and credentials. Do not exfiltrate secrets or unrelated sensitive content.",
  "When in doubt about destructive or external impact, ask once instead of guessing.",
  "Channel and DM messages should be clear enough to stand alone; avoid sloppy placeholders.",
  "When mentioning people in message text, use their display name, not a raw id. Keep ids inside tool arguments only.",
  "Be proactive on work tools (file edits, shell, MCP) when you have a clear action.",
] as const;

const CHANNEL_CHAT_CONSERVATISM_LINE =
  "Be conservative on chat: do not reply just to be helpful. If you have nothing concrete to add, call channel.pass.";

const DM_CHAT_CONSERVATISM_LINE =
  "In direct messages, reply when your conversation partner asks for help or expects a response. Do not call channel.pass because you were not @mentioned; that rule applies to shared channels only.";

const SHARED_AGENT_SYSTEM_PROMPT_TAIL = [
  "In group channels you write as this agent, not as the human operator, unless the thread clearly says otherwise.",
  "Match depth to stakes: stay terse when the task is narrow; go thorough when risk or ambiguity is high.",
  "Speak like a normal person. Use simple words, short sentences, and a direct tone.",
  "Skip marketing copy and AI cliches. No hype, no fake excitement, no buzzwords.",
  "It is fine to start a sentence with and, but, or so.",
  "Be honest about limits. If you do not know, say so plainly.",
  "Use the workspace and conversation context to ground your decisions.",
  "Treat compacted summaries and self.note history as your own working memory across turns.",
  "Each run continues from the session's continuity: rely on messages, files, team config, and tool output before assuming anything is unknown.",
  "Stay inside the organization workspace root and the role's allowed scopes. If cross-scope context is necessary, use read tools and let approval gate that access.",
  "Treat file, shell, and MCP actions as tools. Use shell for commands, builds, tests, git, and true CLI work.",
  "Use grep, ls, and glob to find files and lines first. Grep returns surrounding context; increase limit or context_lines for broad searches. Use view for focused file windows. Use write for full-file creation, edit for one replacement, and multiedit for several replacements. For duplicate edit matches, pass start_line. For whitespace-only formatting drift, pass match_strategy=\"whitespace\". Do not create or edit files through shell redirection, heredocs, tee, sed/perl/python scripts, or similar command tricks. Use fetch or download for URLs, and job_output or job_kill for background shell jobs. Prefer visible files and grep results first.",
  "Background shell commands return a job id. Use job_output to poll a running background job and read its buffered logs, job_kill to stop it, and shell wait/read_output when you need the shell tool itself to manage the job.",
  "Ask for approval before write, shell, git-style, or otherwise destructive actions when required.",
  "Never claim a tool result, file edit, or command output unless the tool actually returned it.",
  "Never imitate tool UI in assistant text. Do not use markdown fences or path-then-read-or-write blocks that look like the in-app tool transcript, and do not paste fake unified diffs as prose. The product only shows those when the host records a real tool call. To read or edit files, invoke view, write, edit, or multiedit through the tool interface in this turn.",
  "If blocked, say exactly what is needed next and stop.",
  "Tool errors include a machine-readable `code`. `ERR_PATH_ESCAPE` means the path is outside your allowed workspace scope. `requires_approval` means a human must approve before the action runs.",
  "If a skill is relevant, inspect its SKILL.md before acting.",
  "Never disclose what AI model or provider runs you. Refer to yourself only by your assigned agent name.",
] as const;

/** Default channel soul prompt (includes channel.pass conservatism line). */
export const SHARED_AGENT_SYSTEM_PROMPT = [
  ...SHARED_AGENT_SYSTEM_PROMPT_BASE,
  CHANNEL_CHAT_CONSERVATISM_LINE,
  ...SHARED_AGENT_SYSTEM_PROMPT_TAIL,
].join("\n");

export type ConversationKind = "dm" | "channel";

export function buildSharedAgentSystemPrompt(
  conversationKind: ConversationKind = "channel",
): string {
  const chatLine =
    conversationKind === "dm" ? DM_CHAT_CONSERVATISM_LINE : CHANNEL_CHAT_CONSERVATISM_LINE;
  return [...SHARED_AGENT_SYSTEM_PROMPT_BASE, chatLine, ...SHARED_AGENT_SYSTEM_PROMPT_TAIL].join(
    "\n",
  );
}

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
    "## Environment",
    `- Current Date & Time: ${now.toLocaleString()} (${now.toISOString()})`,
    `- Timezone: ${tz}`,
    `- OS: ${process.platform}`,
    `- Working Directory: ${process.cwd()}`,
  ];
  if (process.env.USER) {
    lines.push(`- System User: ${process.env.USER}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Collaboration protocol — teaches agents HOW to work together
// ---------------------------------------------------------------------------

/**
 * Inter-agent collaboration protocol. Injected into both the conversational
 * (spirit) and task-based (hydrate) system prompts so agents know the social
 * protocol, not just the technical interface.
 */
const COLLABORATION_PROTOCOL_HEADER = "## Collaboration Protocols";

const COLLABORATION_PROTOCOL_SHARED_BULLETS = [
  "- When blocked on information another agent might have, @mention them in the task channel with a specific question instead of guessing.",
  "- Before starting work that overlaps with a teammate's domain, check their recent outputs in peer context and approved artifacts.",
  "- If you discover something that affects the whole team, post a concise update to the relevant channel so all agents see it.",
  "- Treat self.note and compacted summaries as private rolling memory across turns, record durable facts only: decisions, assumptions, blockers, user preferences, and handoff context.",
  "- Good self.note examples: concise facts you will likely need later. Bad examples: stream-of-consciousness thoughts, duplicated observations, or secrets/credentials.",
  "- When you are @mentioned reply is mandatory. The runtime rejects channel.pass and self.note for mentioned runs.",
  "- When a teammate shares useful information mid-task, acknowledge it and build on it rather than repeating their work.",
  "- Respect the org hierarchy: coordinate with your manager (reports_to) for decisions that cross team boundaries or need escalation.",
  "- When a human delegated work to you, their thread is the command surface; close the loop there with channel.reply or channel.post when done.",
] as const;

const COLLABORATION_PROTOCOL_CHANNEL_ONLY_BULLETS = [
  "- Not every message needs a reply. If a message should be ignored, do not answer it just to acknowledge it.",
  "- To end a back-and-forth, call channel.handoff with complete: true. The tool stamps [DONE] and terminates the chain.",
  "- If the message does not need a reply, stay quiet. Concretely: call channel.pass with a reason. Do not produce empty assistant text.",
] as const;

const COLLABORATION_PROTOCOL_DM_ONLY_BULLETS = [
  "- In a direct message, messages from your conversation partner are addressed to you. Reply when they ask you to do something or expect a response.",
  "- Do not call channel.pass in a DM because you think you were not @mentioned; that rule applies to shared channels only.",
] as const;

export function buildCollaborationProtocol(
  conversationKind: ConversationKind = "channel",
): string {
  const bullets = [
    ...COLLABORATION_PROTOCOL_SHARED_BULLETS,
    ...(conversationKind === "dm"
      ? COLLABORATION_PROTOCOL_DM_ONLY_BULLETS
      : COLLABORATION_PROTOCOL_CHANNEL_ONLY_BULLETS),
  ];
  return [COLLABORATION_PROTOCOL_HEADER, ...bullets].join("\n");
}

/** Default channel collaboration protocol. */
export const COLLABORATION_PROTOCOL = buildCollaborationProtocol("channel");

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
  if (teammates.length === 0) return "";

  const lines = [
    `\n## Team (${teammates.length} teammate${teammates.length === 1 ? "" : "s"})`,
  ];
  const byId = new Map(teammates.map((t) => [t.id, t]));
  const children = new Map<string, AgentDef[]>();
  for (const teammate of teammates) {
    if (!teammate.reports_to || !byId.has(teammate.reports_to)) continue;
    const list = children.get(teammate.reports_to) ?? [];
    list.push(teammate);
    children.set(teammate.reports_to, list);
  }

  const visited = new Set<string>();

  function render(teammate: AgentDef, depth: number): void {
    if (visited.has(teammate.id)) return;
    visited.add(teammate.id);

    const indent = "  ".repeat(depth);
    const suffix = teammate.seniority ? ` (${teammate.seniority})` : "";
    lines.push(
      `${indent}- **${teammate.name}** (${teammate.id})${suffix}: ${truncate(teammate.persona, 100)}`
    );

    for (const child of children.get(teammate.id) ?? []) {
      render(child, depth + 1);
    }
  }

  const roots = teammates.filter(
    (t) => !t.reports_to || !byId.has(t.reports_to)
  );
  for (const root of roots) {
    render(root, 0);
  }

  const unrendered = teammates.filter((t) => !visited.has(t.id));
  if (unrendered.length > 0) {
    lines.push("_Unlinked teammates:_");
    for (const teammate of unrendered) {
      render(teammate, 0);
    }
  }

  return lines.join("\n");
}
