import type { Channel, Member, OrganizationChart } from '@ujima/shared';
import { getPersonalityPreset } from './personality.js';
import type { AgentConfig, RoleConfig } from './schemas.js';

/**
 * Baseline “soul” for every agent. Kept aligned with `.agents/SOUL.md` (full prose).
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
  'Speak and behave like a teammate inside the company.',
  'Use the workspace and conversation context to ground your decisions.',
  "Stay inside the organization workspace root and the role's allowed scopes.",
  'Treat filesystem, shell, and MCP as tools. Shell is the general execution path, including git commands.',
  'Ask for approval before write, shell, git-style, or otherwise destructive actions when required.',
  'Never claim a tool result, file edit, or command output unless the tool actually returned it.',
  'If blocked, say exactly what is needed next and stop.',
  'If a skill is relevant, inspect its SKILL.md before acting.',
  'Each run is a fresh context window: rely on this session’s messages, files, team config, and tool output rather than assumed memory.',
].join('\n');

function listTools(role: RoleConfig): string {
  return role.tools.length ? role.tools.join(', ') : 'none';
}

function listScopes(role: RoleConfig): string {
  return role.workspaceScopes.length ? role.workspaceScopes.join(', ') : 'none';
}

function listChannels(role: RoleConfig): string {
  return role.channels.length ? role.channels.join(', ') : 'none';
}

function formatChannelTargets(channels: Channel[]): string {
  return channels.length
    ? channels.map((channel) => `- ${channel.name} [${channel.id}] (${channel.kind})`).join('\n')
    : '- none';
}

function formatDirectMessageTargets(currentMemberId: string, members: Member[]): string {
  const targets = members.filter((member) => member.id !== currentMemberId);

  return targets.length
    ? targets.map((member) => `- ${member.name} [${member.id}]`).join('\n')
    : '- none';
}

function formatJoinedAt(value: string | undefined): string {
  return value ? value.slice(0, 10) : 'unknown';
}

function formatMemberLine(member: Member, agent?: AgentConfig): string {
  const personality = agent ? getPersonalityPreset(agent.personalityName) : undefined;
  const parts = [
    member.name,
    member.roleName,
    member.kind,
    `joined ${formatJoinedAt(member.createdAt)}`,
  ];

  if (personality) {
    parts.splice(2, 0, personality.title);
  }

  return `- ${parts.join(' | ')}`;
}

function formatOrgChart(members: Member[], chart: OrganizationChart): string {
  const roots = members.filter((member) => !chart.reportsTo[member.id]);
  const visited = new Set<string>();
  const byId = new Map(members.map((member) => [member.id, member]));

  const renderNode = (member: Member, depth: number): string[] => {
    if (visited.has(member.id)) {
      return [];
    }
    visited.add(member.id);

    const indent = '  '.repeat(depth);
    const line = `${indent}- ${member.name} (${member.roleName}, ${member.kind}, joined ${formatJoinedAt(member.createdAt)})`;
    const children = members.filter((child) => chart.reportsTo[child.id] === member.id);
    return [line, ...children.flatMap((child) => renderNode(child, depth + 1))];
  };

  return roots.length
    ? roots.flatMap((member) => renderNode(member, 0)).join('\n')
    : members
        .map((member) => {
          const resolved = byId.get(member.id) ?? member;
          return formatMemberLine(resolved);
        })
        .join('\n');
}

function buildOrganizationContextPrompt(
  organizationName: string,
  members: Member[],
  agents: AgentConfig[],
  organizationChart: OrganizationChart,
): string {
  const agentsByName = new Map(agents.map((agent) => [agent.name, agent]));

  return [
    `Organization: ${organizationName}`,
    'Employees:',
    members.map((member) => formatMemberLine(member, agentsByName.get(member.name))).join('\n'),
    'Hierarchy:',
    formatOrgChart(members, organizationChart),
  ].join('\n');
}

export function buildAgentSystemPrompt(
  workspaceRoot: string,
  organizationName: string,
  currentMemberId: string,
  currentThreadId: string,
  agent: AgentConfig,
  role: RoleConfig,
  members: Member[] = [],
  agents: AgentConfig[] = [],
  channels: Channel[] = [],
  organizationChart: OrganizationChart = { reportsTo: {} },
): string {
  const accessibleChannels = role.channels.length
    ? channels.filter((channel) => role.channels.includes(channel.name))
    : channels;
  const personality = getPersonalityPreset(agent.personalityName);

  return [
    `You are ${agent.name}, an employee of ${organizationName}, acting as ${role.title} (${role.name}).`,
    personality ? `Personality: ${personality.title} (${personality.name})` : '',
    SHARED_AGENT_SYSTEM_PROMPT,
    '',
    "Use 'I' as an employee of the organization, not as a generic assistant.",
    role.description ? `Role objective: ${role.description}` : '',
    role.instructions,
    personality?.instructions ?? '',
    '',
    buildOrganizationContextPrompt(organizationName, members, agents, organizationChart),
    '',
    'Messaging:',
    `Current thread ID: ${currentThreadId}`,
    'Accessible channel IDs:',
    formatChannelTargets(accessibleChannels),
    'Direct message recipient IDs:',
    formatDirectMessageTargets(currentMemberId, members),
    'Use destination: thread for the current conversation, channel for a channel post, and dm for a direct recipient.',
    'If the request asks you to act, use the relevant tool immediately instead of describing the action. For channel posts use channel.post, for direct messages use channel.dm, and for in-thread replies use channel.reply.',
    '',
    `Workspace root: ${workspaceRoot}`,
    `Allowed scopes: ${listScopes(role)}`,
    `Available tools: ${listTools(role)}`,
    `Available channels: ${listChannels(role)}`,
  ]
    .filter(Boolean)
    .join('\n');
}
