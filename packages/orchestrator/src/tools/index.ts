import type { OrchestratorTool } from './types.js';
import {
  channelDmTool,
  channelListTool,
  channelPostTool,
  channelReadTool,
  channelReplyTool,
  selfNoteTool,
} from './channel.js';
import { filesystemTool } from './filesystem.js';
import { shellTool } from './shell.js';
import { messageTool } from './message.js';
import {
  supervisorTodoAddTool,
  supervisorTodoCheckTool,
  supervisorTodoListTool,
} from './supervisor-todo.js';

export const ORCHESTRATOR_TOOLS = {
  'channel.post': channelPostTool,
  'channel.reply': channelReplyTool,
  'channel.dm': channelDmTool,
  'channel.list': channelListTool,
  'channel.read': channelReadTool,
  filesystem: filesystemTool,
  shell: shellTool,
  'self.note': selfNoteTool,
  message: messageTool,
  'supervisor.todo.add': supervisorTodoAddTool,
  'supervisor.todo.check': supervisorTodoCheckTool,
  'supervisor.todo.list': supervisorTodoListTool,
} as unknown as Record<string, OrchestratorTool>;

// Tools an agent always has access to, regardless of its role's `tools`
// allowlist.
//
// `self.note` is the only unconditional tool: the agent must always be
// able to think to itself. Chat tools stay in the normal role bundle.
export const ALWAYS_AVAILABLE_AGENT_TOOLS = Object.freeze(['self.note'] as const);

// Supervisor's strict tool allowlist — read-only / annotation-only tools
// plus the same channel surface we let workers use.
// The supervisor turn never gets `filesystem`, `shell`, or any MCP write.
// Channel reads, channel replies/DMs, and the three `supervisor.todo.*` jot
// tools are the entire surface (E4.2.4).
//
// The list is enforced in two complementary places:
//   1. SpiritService.resolveToolAllowlist restricts what enters the model
//      palette when role==='supervisor', so the model can't even see the
//      forbidden tools.
//   2. ToolService validates the requested tool id against this list when
//      the invocation is tagged `permissionMcpId: 'supervisor'`, catching
//      out-of-band invocations (e.g. a custom tool that hardcodes
//      `permissionMcpId: 'supervisor'` on a non-allowlisted tool id).
export const SUPERVISOR_TOOL_ALLOWLIST = Object.freeze([
  'self.note',
  'channel.read',
  'channel.list',
  'channel.post',
  'channel.dm',
  'channel.reply',
  'supervisor.todo.add',
  'supervisor.todo.check',
  'supervisor.todo.list',
] as const);

/** @deprecated Renamed to {@link SUPERVISOR_TOOL_ALLOWLIST}. Kept for one cycle. */
export const SUPERVISOR_ALLOWED_TOOLS = SUPERVISOR_TOOL_ALLOWLIST;

export type { OrchestratorTool, ToolExecutionContext } from './types.js';
export { listBackgroundJobs, terminateBackgroundJob, peekBackgroundJob } from './shell.js';
export type { BackgroundJobSnapshot } from './shell.js';
