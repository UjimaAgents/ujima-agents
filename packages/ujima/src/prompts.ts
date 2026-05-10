import { readdirSync } from 'node:fs';
import type { Channel, Member, OrganizationChart } from '@ujima/shared';
import { SHARED_AGENT_SYSTEM_PROMPT, COLLABORATION_PROTOCOL, buildEnvironmentContext } from '@ujima/shared';
import { getPersonalityPreset } from './personality.js';
import type { AgentConfig, RoleConfig } from './schemas.js';

export { SHARED_AGENT_SYSTEM_PROMPT } from '@ujima/shared';

export const MESSAGE_TOOL_USAGE_GUIDANCE = [
  'Default to a normal plain-text reply for conversational responses.',
  'Not every message needs a reply. If a message should be ignored, do not answer it just to acknowledge it.',
  'Use message/channel tools only for explicit side effects: posting to another channel, sending a DM, or posting an in-thread relay on request.',
  'To end a back-and-forth, send a message that contains only the word "Acknowledged." (with a period). Adding any other text — a question, a follow-up sentence, anything — makes the message a normal reply that will wake the other agent.',
  'If the message does not need a reply, stay quiet.',
  'Use ignore: true on dm messages when you want a private acknowledgement without waking the recipient or posting public channel follow-up.',
  'Never do both for one response: either send via tool or answer in plain text, not both.',
  'If you used a message/channel tool to send the response, keep any remaining assistant text empty.',
] as const;

function listTools(role: RoleConfig): string {
  return role.tools.length ? role.tools.join(', ') : 'none';
}

function listScopes(role: RoleConfig): string {
  return role.workspaceScopes.length ? role.workspaceScopes.join(', ') : 'none';
}

function listChannels(role: RoleConfig): string {
  return role.channels.length ? role.channels.join(', ') : 'none';
}

function formatWorkspaceLayout(workspaceRoot: string): string {
  const entries = readdirSync(workspaceRoot, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (directories.length === 0) return '';

  return [
    '## Workspace Layout',
    'Top-level directories:',
    ...directories.map((entry) => `- ${entry}`),
    'Use these names first when choosing a shell cwd or repo path.',
  ].join('\n');
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
    buildEnvironmentContext(),
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
    'For DM chats, use the other person\'s member id as the conversation reference. channel.read resolves it to the DM thread automatically.',
    'Use destination: thread for the current conversation, channel for a channel post, and dm for a direct recipient.',
    ...MESSAGE_TOOL_USAGE_GUIDANCE,
    'If the message is a greeting, check-in, or casual question, reply briefly instead of staying silent.',
    '',
    COLLABORATION_PROTOCOL,
    '',
    `Workspace root: ${workspaceRoot}`,
    `Allowed scopes: ${listScopes(role)}`,
    formatWorkspaceLayout(workspaceRoot),
    `Available tools: ${listTools(role)}`,
    `Available channels: ${listChannels(role)}`,
  ]
    .filter(Boolean)
    .join('\n');
}
