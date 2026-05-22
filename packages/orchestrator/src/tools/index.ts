import type { OrchestratorTool } from './types.js';
import {
  channelAckTool,
  channelDmTool,
  channelHandoffTool,
  channelListTool,
  channelPassTool,
  channelPostTool,
  channelReadTool,
  channelReplyTool,
  selfNoteTool,
} from './channel.js';
import { channelRecallTool } from './channel-recall.js';
import { filesystemTool } from './filesystem.js';
import { grepTool } from './grep.js';
import { jobKillTool, jobOutputTool } from './job-tools.js';
import { downloadTool, fetchTool } from './web-tools.js';
import { shellTool } from './shell.js';
import { messageTool } from './message.js';
import { scheduleTool } from './schedule.js';
import { webSearchTool } from './web-search.js';
import { memoryForgetTool, memoryRecallTool, memoryWriteTool } from './memory.js';
import { selfProcedureAddTool, selfProcedureRemoveTool } from './self-procedure.js';
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
  'channel.ack': channelAckTool,
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
  'self.procedure.add': selfProcedureAddTool,
  'self.procedure.remove': selfProcedureRemoveTool,
  'channel.recall': channelRecallTool,
  'memory.write': memoryWriteTool,
  'memory.recall': memoryRecallTool,
  'memory.forget': memoryForgetTool,
  message: messageTool,
  schedule: scheduleTool,
  'supervisor.todo.add': supervisorTodoAddTool,
  'supervisor.todo.check': supervisorTodoCheckTool,
  'supervisor.todo.list': supervisorTodoListTool,
} as unknown as Record<string, OrchestratorTool>;

// Tools an agent always has access to, regardless of its role's `tools`
// allowlist.
//
// Includes the conversation primitives every agent should be able to
// reach on any wake, plus the schedule tool: read the channel, post a
// reply, post a fresh message, send a DM, schedule follow-ups, and use
// the silent-outcome / private-note tools. Without these in the
// always-available list, an agent whose role config has `tools: []`
// ends up with an empty palette and the model either fails or
// improvises tool-call syntax as prose text (Gemini does this).
// Keeping these tools always-on means the runtime knows the model's
// intent through structured tool calls instead of having to guess from
// free-text output.
//
// `channel.handoff` stays OPT-IN (must be declared in role.tools)
// because hand-offs are a workflow primitive, not a baseline
// conversational primitive.
//
// Mandatory-reply and DM wake policy (`resolveWakeReplyPolicy`) strips
// `channel.pass` and `self.note` from the palette at wake-time in
// ai-service.ts and spirit.ts, keeping posting tools available so the
// agent can comply.
//
// Read-only workspace tools (`view`, `ls`, `glob`, `grep`) are
// baseline because the product mental model is "an employee with a
// workspace" — every agent can look at the files the channel
// references. Writes (`filesystem`, `edit`, `multiedit`, `write`,
// `shell`, `download`) stay opt-in via `role.tools` because those
// are real authority, not perception. Workspace-boundary enforcement
// in `policy.ts` (`assertWorkspaceBoundary` + `isSensitiveWorkspacePath`)
// still gates reads, so `.env`/`.git/config`-class paths remain
// approval-gated. `channel.ack` is the silent terminator used to
// satisfy the mandatory-reply contract without producing a wake-able
// message (Bet 3 — kills the echo-loop pathology).
export const ALWAYS_AVAILABLE_AGENT_TOOLS = Object.freeze([
  'self.note',
  'self.procedure.add',
  'self.procedure.remove',
  'channel.pass',
  'channel.ack',
  'channel.reply',
  'channel.post',
  'channel.dm',
  'channel.recall',
  'message',
  'channel.read',
  'channel.list',
  'view',
  'ls',
  'glob',
  'grep',
  'schedule',
  'memory.write',
  'memory.recall',
  'memory.forget',
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
