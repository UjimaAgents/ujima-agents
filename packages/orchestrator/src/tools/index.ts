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
} as unknown as Record<string, OrchestratorTool>;

export const ALWAYS_AVAILABLE_AGENT_TOOLS = Object.freeze([
  'channel.post',
  'channel.reply',
  'channel.dm',
  'channel.list',
  'channel.read',
  'self.note',
]);

export type { OrchestratorTool, ToolExecutionContext } from './types.js';
