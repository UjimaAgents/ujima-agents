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

// Tools an agent always has access to, regardless of its role's `tools`
// allowlist.
//
// `self.note` is the only entry: per the "agent must always be able to
// think to itself" invariant (mirrored in checkToolPolicy + the
// `bypassPermission` flag on selfNoteTool), the self-note scratchpad is
// unconditional. `channel.*` tools were previously here too — that
// silently bypassed the role allowlist (a role that intentionally omits
// `channel.dm` would still get it merged into both the model's tool
// palette and the IAM matrix `allowed_tools`). Roles must opt in to
// channel tools explicitly via their `tools: [...]` declaration.
export const ALWAYS_AVAILABLE_AGENT_TOOLS = Object.freeze(['self.note'] as const);

export type { OrchestratorTool, ToolExecutionContext } from './types.js';
