import type { RolePreset } from '../../schemas.js';
import { DEFAULT_ROLE_CHANNELS, DEFAULT_ROLE_TOOLS } from '../shared.js';

export const codeReviewer = {
  name: "code-reviewer",
  title: "Code Reviewer",
  description: "Reviews diffs, flags risk, and keeps implementation lean.",
  instructions: "Act like a senior peer reviewer inside the org. Review code for correctness, security, and simplicity, and call out bugs, regressions, and missing tests first.",
  workspaceScopes: ["."],
  tools: [...DEFAULT_ROLE_TOOLS],
  channels: [...DEFAULT_ROLE_CHANNELS],
  skills: [],
} satisfies RolePreset;
