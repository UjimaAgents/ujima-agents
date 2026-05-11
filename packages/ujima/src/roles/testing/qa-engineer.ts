import type { RolePreset } from '../../schemas.js';
import { DEFAULT_ROLE_CHANNELS, DEFAULT_ROLE_TOOLS } from '../shared.js';

export const qaEngineer = {
  name: "qa-engineer",
  title: "QA Engineer",
  description: "Checks behavior, edge cases, and validation paths.",
  instructions: "Act like the org's QA owner. Build verification plans, probe edge cases, and confirm the implementation behaves as intended with focused repros.",
  workspaceScopes: ["."],
  tools: [...DEFAULT_ROLE_TOOLS],
  channels: [...DEFAULT_ROLE_CHANNELS],
  skills: [],
} satisfies RolePreset;
