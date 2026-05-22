import { ROLE_PRESETS } from './roles/index.js';
import type { PersonalityPreset } from './schemas.js';
import type { ToolCapability } from '@ujima/shared';

export const DEFAULT_TOOL_CATALOG: Record<string, ToolCapability> = {
  filesystem: {
    id: 'filesystem',
    name: 'Filesystem',
    description:
      'Legacy file tool: read line windows or apply unified-diff patches. Prefer view/read for file reads and write/edit/multiedit for normal file changes.',
    actions: ['read', 'write'],
    pathScopes: ['.'],
    requiresApproval: true,
  },
  view: {
    id: 'view',
    name: 'View',
    description: 'Read a workspace file in a numbered window. Accepts file_path or resourcePath, offset, and limit.',
    actions: ['read'],
    pathScopes: ['.'],
    requiresApproval: false,
  },
  write: {
    id: 'write',
    name: 'Write',
    description: 'Create or overwrite one workspace file with full content. Use for new files or large rewrites. Accepts file_path and content. For surgical edits use edit or multiedit.',
    actions: ['write'],
    pathScopes: ['.'],
    requiresApproval: true,
  },
  edit: {
    id: 'edit',
    name: 'Edit',
    description: 'Edit one file by exact find-and-replace. Accepts file_path, old_string, new_string, and replace_all. Prefer this over shell for small file changes.',
    actions: ['write'],
    pathScopes: ['.'],
    requiresApproval: true,
  },
  multiedit: {
    id: 'multiedit',
    name: 'Multi Edit',
    description: 'Apply multiple exact find-and-replace edits to one file in order. Accepts file_path and edits with old_string/new_string. Prefer this over shell for multiple changes in one file.',
    actions: ['write'],
    pathScopes: ['.'],
    requiresApproval: true,
  },
  ls: {
    id: 'ls',
    name: 'List',
    description: 'List workspace files and folders from a path.',
    actions: ['read'],
    pathScopes: ['.'],
    requiresApproval: false,
  },
  glob: {
    id: 'glob',
    name: 'Glob',
    description: 'Find workspace files matching a glob pattern.',
    actions: ['read'],
    pathScopes: ['.'],
    requiresApproval: false,
  },
  grep: {
    id: 'grep',
    name: 'Grep',
    description: 'Search visible workspace files for matching lines, then use filesystem.read for a focused window around the hit.',
    actions: ['read'],
    pathScopes: ['.'],
    requiresApproval: false,
  },
  fetch: {
    id: 'fetch',
    name: 'Fetch',
    description: 'Fetch a URL and return its response body.',
    actions: ['read'],
    pathScopes: [],
    requiresApproval: false,
  },
  download: {
    id: 'download',
    name: 'Download',
    description: 'Download a URL into a workspace file.',
    actions: ['write'],
    pathScopes: ['.'],
    requiresApproval: true,
  },
  job_output: {
    id: 'job_output',
    name: 'Job Output',
    description: 'Read buffered output for a background shell job.',
    actions: ['read'],
    pathScopes: [],
    requiresApproval: false,
  },
  job_kill: {
    id: 'job_kill',
    name: 'Job Kill',
    description: 'Stop a background shell job.',
    actions: ['execute'],
    pathScopes: [],
    requiresApproval: true,
  },
  shell: {
    id: 'shell',
    name: 'Shell',
    description: 'Run local commands inside the organization workspace for builds, tests, git, and real CLI work. Do not create or edit files with shell redirection, heredocs, sed/perl/python scripts, or tee; use write, edit, or multiedit.',
    actions: ['execute'],
    pathScopes: ['.'],
    requiresApproval: true,
  },
  web_search: {
    id: 'web_search',
    name: 'Web Search',
    description: 'Search the web for live results using a provider-backed search path with DuckDuckGo fallback.',
    actions: ['read'],
    pathScopes: [],
    requiresApproval: false,
  },
  message: {
    id: 'message',
    name: 'Message',
    description: 'Send messages to channels, threads, and direct message recipients. Use ignore on DMs only for a private note, not for skipping a real reply.',
    actions: ['message'],
    pathScopes: [],
    requiresApproval: false,
  },
  schedule: {
    id: 'schedule',
    name: 'Schedule',
    description: 'Create, list, or cancel recurring schedules for an organization.',
    actions: ['read', 'execute'],
    pathScopes: [],
    requiresApproval: false,
  },
  'channel.post': {
    id: 'channel.post',
    name: 'Channel Post',
    description: 'Post a new message to a channel. Use channel.reply for replies in an existing thread. Write @mentions with display names, not raw ids.',
    actions: ['message'],
    pathScopes: [],
    requiresApproval: false,
  },
  'channel.reply': {
    id: 'channel.reply',
    name: 'Channel Reply',
    description: 'Reply to a message inside its existing thread.',
    actions: ['message'],
    pathScopes: [],
    requiresApproval: false,
  },
  'channel.dm': {
    id: 'channel.dm',
    name: 'Channel DM',
    description: 'Send a direct message, lazily creating the DM channel when needed. Use ignore for a private DM that skips wake fanout, not for deciding whether to reply.',
    actions: ['message'],
    pathScopes: [],
    requiresApproval: false,
  },
  'channel.list': {
    id: 'channel.list',
    name: 'Channel List',
    description: 'List visible channels in the organization.',
    actions: ['message'],
    pathScopes: [],
    requiresApproval: false,
  },
  'channel.read': {
    id: 'channel.read',
    name: 'Channel Read',
    description: 'Read recent or searched messages from a channel.',
    actions: ['message'],
    pathScopes: [],
    requiresApproval: false,
  },
  'self.note': {
    id: 'self.note',
    name: 'Self Note',
    description: 'Write a private note into the member self-channel.',
    actions: ['message'],
    pathScopes: [],
    requiresApproval: false,
  },
  mcp: {
    id: 'mcp',
    name: 'MCP',
    description: 'Call approved MCP servers and tool adapters.',
    actions: ['mcp'],
    pathScopes: [],
    requiresApproval: true,
  },
};

export const PERSONALITY_PRESETS: Record<string, PersonalityPreset> = {
  direct: {
    name: 'direct',
    title: 'Direct',
    description: 'Brief, decisive, and low on fluff.',
    instructions:
      'Speak plainly and get to the point. Prefer short, actionable responses. Do not over-explain when a clear answer exists.',
  },
  thoughtful: {
    name: 'thoughtful',
    title: 'Thoughtful',
    description: 'Balances action with careful consideration.',
    instructions:
      'Slow down enough to notice tradeoffs and hidden assumptions. When the answer is uncertain, say so and explain the decision path.',
  },
  precise: {
    name: 'precise',
    title: 'Precise',
    description: 'Exact, rigorous, and detail-oriented.',
    instructions:
      'Be exact about names, numbers, paths, and constraints. Avoid vague language. Call out anything that needs verification.',
  },
  warm: {
    name: 'warm',
    title: 'Warm',
    description: 'Collaborative and easy to work with.',
    instructions:
      'Be friendly and encouraging without losing clarity. Help the team move forward with a calm, human tone.',
  },
  skeptical: {
    name: 'skeptical',
    title: 'Skeptical',
    description: 'Questions assumptions and looks for failure modes.',
    instructions:
      'Pressure-test claims, look for edge cases, and challenge unsafe or unproven plans. Prefer proof over optimism.',
  },
  pragmatic: {
    name: 'pragmatic',
    title: 'Pragmatic',
    description: 'Biases toward the simplest working path.',
    instructions:
      'Choose the smallest implementation that solves the problem. Avoid unnecessary abstraction and keep decisions grounded in current constraints.',
  },
};

export { ROLE_PRESETS };
