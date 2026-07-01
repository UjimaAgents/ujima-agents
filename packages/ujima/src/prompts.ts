import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Channel, Member, OrganizationChart, SkillInstall } from '@ujima/shared';
import {
  buildCollaborationProtocol,
  buildSharedAgentSystemPrompt,
  type ConversationKind,
  buildEnvironmentContext,
  shouldSkipWorkspaceTreeDirectory,
} from '@ujima/shared';
import { getPersonalityPreset } from './personality.js';
import type { AgentConfig, RoleConfig } from './schemas.js';

export { SHARED_AGENT_SYSTEM_PROMPT } from '@ujima/shared';

export const MESSAGE_TOOL_USAGE_GUIDANCE = [
  'Most messages do not need a reply from you. If a message is not addressed to you, not in your domain, or already handled by another agent, call channel.pass with the appropriate reason and stop. Do not emit any chat text alongside channel.pass.',
  'If you are @mentioned, reply is mandatory. The runtime will reject channel.pass for mentioned runs. Use channel.reply to respond, even if your answer is short.',
  'channel.handoff({ to, reason, deliverable, complete }) returns completed work to the original asker. Set complete: true only when the chain is genuinely finished. Do not write [HANDOFF] or [DONE] in plain text — the handoff tool stamps them.',
  'Never call a current-thread posting terminator and also produce assistant chat text in the same turn. If you used channel.dm to message another member, continue and close the loop in the current thread.',
  'Pick exactly one terminating tool when closing the current thread: channel.reply, channel.post, channel.handoff, or channel.pass. channel.dm sends to another DM thread and then you keep going so you can close the loop where you were asked.',
  'agent.delegate: use kind "explorer" for read-only investigation and kind "worker" for edits or implementation. Explorer delegates get read tools only; worker delegates can use edit/write tools.',
  'In a hand-off chain with 3 or more agents, when you reply, the previous sender is automatically re-mentioned. If you need to bring in an earlier participant, mention them explicitly with @name.',
  'Use ignore: true on dm messages when you want a private acknowledgement without waking the recipient or posting public channel follow-up.',
] as const;

function listToolsLine(toolIds: readonly string[]): string {
  return toolIds.length ? [...toolIds].sort((left, right) => left.localeCompare(right)).join(', ') : 'none';
}

function formatAttachedMcpServers(
  servers: readonly { name: string; toolNames: readonly string[] }[] | undefined,
): string {
  if (!servers || servers.length === 0) return '';
  const lines = servers.map((server) => {
    const tools = server.toolNames.join(', ');
    return `- ${server.name}: ${tools}`;
  });
  return ['Attached MCP servers (you DO have these — call them via their AI-SDK ids in `Available tools`):', ...lines].join(
    '\n',
  );
}

/**
 * Render the V2 spawn's pre-rendered dispatch catalog (PR 3) into the
 * system prompt. Only the V2 spawn passes a value — the legacy spawn
 * leaves this undefined and the block is omitted entirely. The text
 * comes through pre-sanitized; this helper does not inspect it.
 *
 * The framing tells the model these connectors exist but require an
 * extra step to use (get_connector_tools → invoke_connector_tool),
 * so it doesn't conflate them with the always-on Attached MCP servers
 * block above.
 */
function formatAvailableConnectors(catalogText: string | undefined): string {
  if (!catalogText || catalogText.trim().length === 0) return '';
  return [
    'Discoverable connectors (you do NOT have these tools yet; ' +
      'call get_connector_tools(server_id) to see what one provides, ' +
      'then invoke_connector_tool(server_id, tool_name, args) to use it):',
    catalogText,
  ].join('\n');
}

/**
 * Emit an explicit "capabilities you do NOT have" line in the
 * system prompt. Models — especially smaller/faster ones — pattern-
 * match the surface form of capability claims; when the prompt only
 * lists what an agent HAS, the model often improvises confidence
 * about things it doesn't have (the "I can edit the file" pattern).
 * A negative-space line lets the model route requests for missing
 * capabilities to the human or to a teammate who has them, instead
 * of inventing an apology loop.
 */
function formatMissingCapabilities(availableToolIds: readonly string[] | undefined): string {
  if (!availableToolIds) return '';
  const have = new Set(availableToolIds);
  // Capabilities worth flagging by absence — they're the ones agents
  // typically claim or deny without evidence.
  const checks: { id: string; label: string }[] = [
    { id: 'filesystem', label: 'filesystem' },
    { id: 'edit', label: 'edit' },
    { id: 'write', label: 'write' },
    { id: 'multiedit', label: 'multiedit' },
    { id: 'shell', label: 'shell' },
    { id: 'fetch', label: 'fetch' },
    { id: 'download', label: 'download' },
    { id: 'web_search', label: 'web_search' },
  ];
  const missing = checks.filter((c) => !have.has(c.id)).map((c) => c.label);
  if (missing.length === 0) return '';
  // Action-protocol framing rather than personality framing — older
  // wording "do not pretend to" read as a behavioural instruction
  // ("be modest about your capabilities") which smaller models
  // generalised into hedging on tools they DO have. The current
  // wording names the gap as a state of the world and prescribes
  // the routing action.
  return [
    `Tools NOT available to you in this org: ${missing.join(', ')}.`,
    'Requests requiring these tools must be routed — @-mention a teammate whose role includes the tool, or ask the human to enable it for your role. Do not narrate the limitation in chat as content; produce the routing tool call directly.',
  ].join('\n');
}

function listScopes(role: RoleConfig): string {
  return role.workspaceScopes.length ? role.workspaceScopes.join(', ') : 'none';
}

function listChannels(role: RoleConfig): string {
  return role.channels.length ? [...role.channels].sort((left, right) => left.localeCompare(right)).join(', ') : 'none';
}

function formatAvailableSkills(skills: readonly SkillInstall[] | undefined, legacySkills: readonly string[]): string {
  const visible = (skills ?? []).filter((skill) => !skill.disableModelInvocation);
  if (visible.length > 0) {
    return [
      '<available_skills>',
      ...visible.map((skill) =>
        [
          '  <skill>',
          `    <name>${skill.commandName}</name>`,
          `    <description>${skill.description}</description>`,
          `    <location>${skill.skillPath}</location>`,
          `    <plugin>${skill.pluginName}</plugin>`,
          `    <source>${skill.pluginId}</source>`,
          '  </skill>',
        ].join('\n'),
      ),
      '</available_skills>',
    ].join('\n');
  }

  if (legacySkills.length === 0) return '';
  return [
    'Available skills:',
    [...legacySkills].sort((left, right) => left.localeCompare(right)).map((skill) => `- ${skill}`).join('\n'),
  ].join('\n');
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
  // Defensive: archived channels must never reach the system prompt
  // — `channel.read` will throw "Channel not found" on them and the
  // agent has no way to know the id is dead, so it retries forever.
  // Callers should already pre-filter, but this is the last line of
  // defense.
  const visible = channels.filter((channel) => !channel.archivedAt);
  return visible.length
    ? visible.map((channel) => `- ${channel.name} [${channel.id}] (${channel.kind})`).join('\n')
    : '- none';
}

function formatDirectMessageTargets(currentMemberId: string, members: Member[]): string {
  const targets = members
    .filter((member) => member.id !== currentMemberId)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

  return targets.length
    ? targets.map((member) => `- ${member.name} [${member.id}]`).join('\n')
    : '- none';
}

function formatJoinedAt(value: string | undefined): string {
  return value ? value.slice(0, 10) : 'unknown';
}

function resolveAgentForMember(member: Member, agents: AgentConfig[]): AgentConfig | undefined {
  return agents.find((agent) => agent.name === member.id) ?? agents.find((agent) => agent.name === member.name);
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
  return [
    `Organization: ${organizationName}`,
    'Employees:',
    members.map((member) => formatMemberLine(member, resolveAgentForMember(member, agents))).join('\n'),
    'Hierarchy:',
    formatOrgChart(members, organizationChart),
  ].join('\n');
}

export function buildAgentSystemPrompt(
  workspaceRoot: string,
  organizationName: string,
  currentMemberId: string,
  currentMemberName: string,
  currentThreadId: string,
  agent: AgentConfig,
  role: RoleConfig,
  members: Member[] = [],
  agents: AgentConfig[] = [],
  channels: Channel[] = [],
  organizationChart: OrganizationChart = { reportsTo: {} },
  availableSkills?: readonly SkillInstall[],
  /**
   * Final resolved tool ids — `role.tools` ∪ baseline ALWAYS_AVAILABLE
   * conversational tools ∪ MCP-attached tool ids (namespaced). The
   * prompt's "Available tools:" line is the only signal some models
   * use to decide whether they CAN call a tool; if this is empty or
   * stale, agents will deny having tools the AI-SDK palette actually
   * provides (e.g. saying "I don't have a Playwright tool" while
   * `mcp__playwright__*` is wired in). Callers MUST pass the exact
   * tool ids they hand to `runAgentLoop`. Defaults to `role.tools`
   * for backwards compatibility with tests that don't construct an
   * MCP palette, but production callers should always set it.
   */
  availableToolIds?: readonly string[],
  /**
   * MCP servers attached to this member, threaded through so the prompt
   * can render a human-friendly block ("Attached MCP servers: …"). The
   * `availableToolIds` list contains the namespaced AI-SDK ids
   * (e.g. `mcp__playwright_<hash>__browser_close`) which are accurate
   * but cryptic — some models scan for the literal server name when
   * asked "do you have <foo>?" and miss it through the namespace. This
   * block calls out each server by its real name.
   */
  attachedMcpServers?: readonly { name: string; toolNames: readonly string[] }[],
  conversationKind: ConversationKind = 'channel',
  /**
   * Pre-rendered dispatch catalog block produced by the V2 spawn
   * (mcp_connector_dispatch_plan.md §7.4). Only the V2 spawn passes
   * a value; the legacy spawn leaves it undefined and the block is
   * omitted from the prompt entirely. Already sanitized by
   * `resolveConnectorCatalog` — this signature accepts it as plain
   * text and threads it through.
   */
  availableConnectors?: string,
  /**
   * Optional active language model descriptor, used to select
   * model-specific rules files (e.g. `claude.md`, `gemini.md`).
   */
  model?: { provider?: string; modelId?: string } | string | Record<string, unknown>,
): string {
  const sortedMembers = [...members].sort((left, right) =>
    left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  const sortedAgents = [...agents].sort((left, right) => left.name.localeCompare(right.name));
  const accessibleChannels = (role.channels.length
    ? channels.filter((channel) => role.channels.includes(channel.name))
    : channels
  ).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const sortedSkills = availableSkills
    ? [...availableSkills].sort((left, right) =>
        left.commandName.localeCompare(right.commandName) || left.skillPath.localeCompare(right.skillPath),
      )
    : undefined;
  const sortedToolIds = [...(availableToolIds ?? role.tools)].sort((left, right) => left.localeCompare(right));
  const sortedServers = attachedMcpServers
    ? [...attachedMcpServers]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((server) => ({
          ...server,
          toolNames: [...server.toolNames].sort((left, right) => left.localeCompare(right)),
        }))
    : undefined;
  const personality = getPersonalityPreset(agent.personalityName);

  // Load rules files if they exist at any level in workspaceRoot (up to depth 5)
  const agentsRules = findWorkspaceRuleFile(workspaceRoot, ['Agents.md', 'agents.md']);
  const cursorRules = findWorkspaceRuleFile(workspaceRoot, ['cursor.md', 'Cursor.md']);

  let providerName = '';
  let modelId = '';
  if (typeof model === 'string') {
    providerName = model.split('/')[0] || '';
    modelId = model.split('/')[1] || '';
  } else if (model && typeof model === 'object' && 'provider' in model && 'modelId' in model) {
    providerName = String(model.provider ?? '');
    modelId = String(model.modelId ?? '');
  }
  providerName = providerName.toLowerCase();
  modelId = modelId.toLowerCase();
  const isClaude = providerName === 'anthropic' || modelId.includes('claude');
  const isGemini = providerName === 'google' || modelId.includes('gemini');

  let modelRules: string | undefined = undefined;
  if (isClaude) {
    modelRules = findWorkspaceRuleFile(workspaceRoot, ['claude.md', 'Claude.md']);
  } else if (isGemini) {
    modelRules = findWorkspaceRuleFile(workspaceRoot, ['gemini.md', 'Gemini.md']);
  }

  const rulesBlocks: string[] = [];
  if (agentsRules) {
    rulesBlocks.push(`### Agent Guidelines (Agents.md)\n${agentsRules}`);
  }
  if (cursorRules) {
    rulesBlocks.push(`### Editor Guidelines (cursor.md)\n${cursorRules}`);
  }
  if (modelRules) {
    const fileName = isClaude ? 'claude.md' : 'gemini.md';
    rulesBlocks.push(`### Model-Specific Guidelines (${fileName})\n${modelRules}`);
  }
  const rulesBlock = rulesBlocks.length > 0 ? ['## Workspace Rules', ...rulesBlocks].join('\n\n') : '';

  return [
    `You are ${currentMemberName}, an employee of ${organizationName}, acting as ${role.title} (${role.name}).`,
    personality ? `Personality: ${personality.title} (${personality.name})` : '',
    buildSharedAgentSystemPrompt(conversationKind),
    '',
    buildEnvironmentContext(),
    '',
    "Use 'I' as an employee of the organization, not as a generic assistant.",
    role.description ? `Role objective: ${role.description}` : '',
    role.instructions,
    personality?.instructions ?? '',
    '',
    buildOrganizationContextPrompt(organizationName, sortedMembers, sortedAgents, organizationChart),
    '',
    'Messaging:',
    `Current thread ID: ${currentThreadId}`,
    'Accessible channel IDs:',
    formatChannelTargets(accessibleChannels),
    ...(conversationKind === 'channel'
      ? [
          'You are working in a channel. Collaborate with teammates IN THIS CHANNEL — post with channel.post / channel.reply and `@`-mention the people you need. Do NOT open a private DM to a teammate (channel.dm to another member is disabled here); it hides the work, buries approvals, and wastes effort. To hand a task to another agent use agent.delegate. channel.dm is limited to private notes to yourself (member_id: "self").',
        ]
      : [
          'Direct message recipients (channel.dm — id or display name):',
          formatDirectMessageTargets(currentMemberId, members),
        ]),
    'channel.read: channel id/name from the list above; DMs use dm_thread_id or peer member_id from channel.list.',
    ...(conversationKind === 'dm'
      ? MESSAGE_TOOL_USAGE_GUIDANCE.filter(
          (line) =>
            !line.includes('channel.pass with the appropriate reason') &&
            !line.includes('channel.pass for mentioned runs'),
        )
      : MESSAGE_TOOL_USAGE_GUIDANCE),
    '',
    buildCollaborationProtocol(conversationKind),
    '',
    formatAvailableSkills(sortedSkills, role.skills),
    sortedSkills && sortedSkills.length > 0
      ? 'To use a skill: call `skill.read` with its `name` (exactly as shown in <available_skills>) to load the full instructions, then follow them. Match your task to the best skill proactively: before implementing code use incremental-implementation or test-driven-development; before merging use code-review-and-quality; when debugging use debugging-and-error-recovery; when planning use planning-and-task-breakdown or spec-driven-development; when a task is done use whats-next to decide the next move.'
      : '',
    '',
    `Workspace root: ${workspaceRoot}`,
    `Allowed scopes: ${listScopes(role)}`,
    formatWorkspaceLayout(workspaceRoot),
    `Available tools: ${listToolsLine(sortedToolIds)}`,
    formatAttachedMcpServers(sortedServers),
    formatAvailableConnectors(availableConnectors),
    formatMissingCapabilities(sortedToolIds),
    `Available channels: ${listChannels(role)}`,
    rulesBlock ? `\n${rulesBlock}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function findWorkspaceRuleFile(
  currentDir: string,
  filenames: string[],
  maxDepth = 5
): string | undefined {
  // 1. Check current directory first
  for (const filename of filenames) {
    const filePath = join(currentDir, filename);
    if (existsSync(filePath)) {
      try {
        const stat = statSync(filePath);
        if (!stat.isDirectory()) {
          return readFileSync(filePath, 'utf8');
        }
      } catch {
        // ignore
      }
    }
  }

  // Check .agents directory in currentDir
  const agentsDir = join(currentDir, '.agents');
  if (existsSync(agentsDir)) {
    try {
      const stat = statSync(agentsDir);
      if (stat.isDirectory()) {
        for (const filename of filenames) {
          const filePath = join(agentsDir, filename);
          if (existsSync(filePath)) {
            const fileStat = statSync(filePath);
            if (!fileStat.isDirectory()) {
              return readFileSync(filePath, 'utf8');
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Recursive search
  if (maxDepth <= 0) return undefined;

  try {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !shouldSkipWorkspaceTreeDirectory(entry.name) && !entry.name.startsWith('.')) {
        const result = findWorkspaceRuleFile(join(currentDir, entry.name), filenames, maxDepth - 1);
        if (result) return result;
      }
    }
  } catch {
    // ignore
  }

  return undefined;
}
