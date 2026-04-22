import type { OrchestratorTool } from './types.js';
import { filesystemTool } from './filesystem.js';
import { shellTool } from './shell.js';
import { messageTool } from './message.js';

export const ORCHESTRATOR_TOOLS = {
  filesystem: filesystemTool,
  shell: shellTool,
  message: messageTool,
} as unknown as Record<string, OrchestratorTool>;

export type { OrchestratorTool, ToolExecutionContext } from './types.js';
