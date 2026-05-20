import type { OrchestratorTool } from './types.js';
import {
  channelDmTool,
  channelHandoffTool,
  channelListTool,
  channelPassTool,
  channelPostTool,
  channelReadTool,
  channelReplyTool,
  selfNoteTool,
} from './channel.js';
import { filesystemTool } from './filesystem.js';
import { grepTool } from './grep.js';
import { jobKillTool, jobOutputTool } from './job-tools.js';
import { downloadTool, fetchTool } from './web-tools.js';
import { shellTool } from './shell.js';
import { messageTool } from './message.js';
import { webSearchTool } from './web-search.js';
import {
  supervisorTodoAddTool,
  supervisorTodoCheckTool,
  supervisorTodoListTool,
} from './supervisor-todo.js';
import {
  editTool,
  globTool,
  lsTool,
  multieditTool,
  viewTool,
  writeTool,
} from './workspace-tools.js';

export const ORCHESTRATOR_TOOLS = {
  'channel.post': channelPostTool,
  'channel.reply': channelReplyTool,
  'channel.dm': channelDmTool,
  'channel.list': channelListTool,
  'channel.read': channelReadTool,
  'channel.pass': channelPassTool,
  'channel.handoff': channelHandoffTool,
  filesystem: filesystemTool,
  view: viewTool,
  write: writeTool,
  edit: editTool,
  multiedit: multieditTool,
  ls: lsTool,
  glob: globTool,
  grep: grepTool,
  shell: shellTool,
  fetch: fetchTool,
  download: downloadTool,
  job_output: jobOutputTool,
  job_kill: jobKillTool,
  web_search: webSearchTool,
  'self.note': selfNoteTool,
  message: messageTool,
  'supervisor.todo.add': supervisorTodoAddTool,
  'supervisor.todo.check': supervisorTodoCheckTool,
  'supervisor.todo.list': supervisorTodoListTool,
} as unknown as Record<string, OrchestratorTool>;

// Tools an agent always has access to, regardless of its role's `tools`
// allowlist.
//
// Includes the conversation primitives every agent should be able to
// reach on any wake: read the channel, post a reply, post a fresh
// message, send a DM, plus the silent-outcome and private-note
// tools. Without these in the always-available list, an agent whose
// role config has `tools: []` ends up with an empty palette and the
// model either fails or improvises tool-call syntax as prose text
// (Gemini does this). Keeping these tools always-on means the
// runtime knows the model's intent through structured tool calls
// instead of having to guess from free-text output.
//
// `channel.handoff` stays OPT-IN (must be declared in role.tools)
// because hand-offs are a workflow primitive, not a baseline
// conversational primitive.
//
// Mandatory-reply enforcement (the @mention contract) strips
// `channel.pass` and `self.note` from this set at wake-time in
// ai-service.ts, keeping the posting tools available so the agent
// can comply.
export const ALWAYS_AVAILABLE_AGENT_TOOLS = Object.freeze([
  'self.note',
  'channel.pass',
  'channel.reply',
  'channel.post',
  'channel.dm',
  'message',
  'channel.read',
  'channel.list',
] as const);

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
  'channel.pass',
  'channel.handoff',
  'view',
  'ls',
  'glob',
  'fetch',
  'job_output',
  'web_search',
  'supervisor.todo.add',
  'supervisor.todo.check',
  'supervisor.todo.list',
] as const);

/** @deprecated Renamed to {@link SUPERVISOR_TOOL_ALLOWLIST}. Kept for one cycle. */
export const SUPERVISOR_ALLOWED_TOOLS = SUPERVISOR_TOOL_ALLOWLIST;

export type { OrchestratorTool, ToolExecutionContext } from './types.js';
export { listBackgroundJobs, terminateBackgroundJob, peekBackgroundJob } from './shell.js';
export type { BackgroundJobSnapshot } from './shell.js';
