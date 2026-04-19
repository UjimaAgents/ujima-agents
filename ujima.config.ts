import { createStarterAgentTeamConfig } from "@ujima/framework";

export const team = createStarterAgentTeamConfig({
  name: "Ujima Sample Team",
  workspaceRoot: process.cwd(),
});

export default team;

