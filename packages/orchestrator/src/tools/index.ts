import type { OrchestratorTool } from './types.js';
import { filesystemTool } from './filesystem.js';
import { shellTool } from './shell.js';
import { messageTool } from './message.js';

export const ORCHESTRATOR_TOOLS: Record<string, OrchestratorTool<any>> = {
  filesystem: filesystemTool,
  shell: shellTool,
  message: messageTool,
};

export type { OrchestratorTool, ToolExecutionContext } from './types.js';
