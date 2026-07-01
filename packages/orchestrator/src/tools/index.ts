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
  channelSetMemberModeTool,
} from './channel.js';
import { channelRecallTool } from './channel-recall.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { goalStartTool, goalTaskUpdateTool, questionAskTool } from './goal.js';
import { lsTool } from './ls.js';
import { downloadTool, fetchTool } from './web-tools.js';
import { shellTool } from './shell.js';
import { agentDelegateTool } from './agent-delegate.js';
import { scheduleTool } from './schedule.js';
import { webSearchTool } from './web-search.js';
import { memoryForgetTool, memoryRecallTool, memoryWriteTool } from './memory.js';
import {
  selfProcedureAddTool,
  selfProcedureListTool,
  selfProcedureRemoveTool,
  selfProcedureViewTool,
} from './self-procedure.js';
import { procedureTool } from './procedure.js';
import { procedureListTool, procedureViewTool } from './procedure-read.js';
import {
  editTool,
  multieditTool,
  viewTool,
  writeTool,
} from './workspace-tools.js';
import { skillReadTool } from './skill-read.js';
import { SUPERVISOR_TOOL_ALLOWLIST } from '@ujima/shared';

export const ORCHESTRATOR_TOOLS = {
  'channel.post': channelPostTool,
  'channel.reply': channelReplyTool,
  'channel.dm': channelDmTool,
  'channel.list': channelListTool,
  'channel.read': channelReadTool,
  'channel.pass': channelPassTool,
  'channel.ack': channelAckTool,
  'channel.handoff': channelHandoffTool,
  'channel.set_member_mode': channelSetMemberModeTool,
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
  web_search: webSearchTool,
  procedure: procedureTool,
  'self.procedure.add': selfProcedureAddTool,
  'self.procedure.remove': selfProcedureRemoveTool,
  'self.procedure.list': selfProcedureListTool,
  'self.procedure.view': selfProcedureViewTool,
  'procedure.list': procedureListTool,
  'procedure.view': procedureViewTool,
  'channel.recall': channelRecallTool,
  'goal.start': goalStartTool,
  'goal.task.update': goalTaskUpdateTool,
  'question.ask': questionAskTool,
  'memory.write': memoryWriteTool,
  'memory.recall': memoryRecallTool,
  'memory.forget': memoryForgetTool,
  schedule: scheduleTool,
  'agent.delegate': agentDelegateTool,
  'skill.read': skillReadTool,
} as unknown as Record<string, OrchestratorTool>;

// Re-export from shared registry — single source of truth.
export {
  ALWAYS_AVAILABLE_AGENT_TOOLS,
  DEPRECATED_TOOL_ALIASES,
  filterDeprecatedToolIds,
  REMOVED_TOOL_IDS,
  SUPERVISOR_TOOL_ALLOWLIST,
} from '@ujima/shared';

/** @deprecated Renamed to {@link SUPERVISOR_TOOL_ALLOWLIST}. */
export const SUPERVISOR_ALLOWED_TOOLS = SUPERVISOR_TOOL_ALLOWLIST;
export { listBackgroundJobs, terminateBackgroundJob, peekBackgroundJob } from './shell.js';
export type { BackgroundJobSnapshot } from './shell.js';
export type { OrchestratorTool, ToolExecutionContext } from './types.js';
