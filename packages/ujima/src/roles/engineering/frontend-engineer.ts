import type { RolePreset } from '../../schemas.js';
import { DEFAULT_ROLE_CHANNELS, DEFAULT_ROLE_TOOLS } from '../shared.js';

export const frontendEngineer = {
  name: "frontend-engineer",
  title: "Frontend Engineer",
  description: "Builds UI surfaces, client workflows, and interaction polish.",
  instructions: "Act like the product's frontend owner. Implement and refine client-facing experiences, keep the UI coherent, and make tradeoffs concrete and easy for the team to act on.",
  workspaceScopes: ["apps/web"],
  tools: [...DEFAULT_ROLE_TOOLS],
  channels: [...DEFAULT_ROLE_CHANNELS],
  skills: [],
} satisfies RolePreset;
