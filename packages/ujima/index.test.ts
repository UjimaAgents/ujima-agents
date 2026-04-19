import { expect, test } from "bun:test";
import {
  AgentTeam,
  ROLE_PRESETS,
  createRoleFromPreset,
  createStarterAgentTeamConfig,
  defineProvider,
  defineTool,
  loadAgentTeam,
} from "./index.ts";

test("starter config includes the preset team shape", () => {
  const config = createStarterAgentTeamConfig({
    name: "Ujima Demo",
    workspaceRoot: "/tmp/ujima-org",
  });

  expect(config.name).toBe("Ujima Demo");
  expect(config.channels[0].name).toBe("general");
  expect(Object.keys(config.tools)).toContain("filesystem");
  expect(config.roles.map((role) => role.name)).toContain("frontend-engineer");
  expect(config.workspace.root).toBe("/tmp/ujima-org");
  expect(config.workspace.roleScopes["frontend-engineer"][0]).toBe("/tmp/ujima-org/apps/web");
});

test("framework helpers normalize roles, tools, and providers", () => {
  const provider = defineProvider({
    defaultModel: "gpt-4.1-mini",
    models: ["gpt-4.1-mini"],
  });
  const tool = defineTool({
    id: "filesystem",
    name: "Filesystem",
    actions: ["read"],
    pathScopes: ["."],
    requiresApproval: true,
  });
  const role = createRoleFromPreset("frontendEngineer", {
    provider: "openai",
    model: "gpt-4.1-mini",
  });

  expect(provider.defaultModel).toBe("gpt-4.1-mini");
  expect(tool.id).toBe("filesystem");
  expect(role.name).toBe("frontend-engineer");
});

test("AgentTeam normalizes and validates the team config", () => {
  const team = AgentTeam({
    name: "Ujima Demo",
    workspace: {
      root: "/tmp/ujima-org",
      roleScopes: {
        "frontend-engineer": ["apps/web"],
      },
    },
    providers: {
      openai: {
        defaultModel: "gpt-4.1-mini",
        models: ["gpt-4.1-mini"],
      },
    },
    roles: [
      {
        name: "frontend-engineer",
        title: "Frontend Engineer",
        instructions: ROLE_PRESETS.frontendEngineer.instructions,
        provider: "openai",
        model: "gpt-4.1-mini",
        workspaceScopes: ["apps/web"],
        tools: ["filesystem", "git"],
        channels: ["general"],
      },
    ],
  });

  expect(team.kind).toBe("ujima.agent-team");
  expect(team.getRole("frontend-engineer")?.workspaceScopes[0]).toBe("/tmp/ujima-org/apps/web");
  expect(team.getProvider("openai")?.defaultModel).toBe("gpt-4.1-mini");
  expect(team.getChannel("general")?.kind).toBe("general");
});

test("loadAgentTeam returns a ready-to-use handle", () => {
  const team = loadAgentTeam({
    name: "Ujima Demo",
    workspace: {
      root: "/tmp/ujima-org",
      roleScopes: {
        "frontend-engineer": ["apps/web"],
      },
    },
    providers: {
      openai: {
        defaultModel: "gpt-4.1-mini",
        models: ["gpt-4.1-mini"],
      },
    },
    roles: [
      {
        name: "frontend-engineer",
        title: "Frontend Engineer",
        instructions: ROLE_PRESETS.frontendEngineer.instructions,
        provider: "openai",
        model: "gpt-4.1-mini",
        workspaceScopes: ["apps/web"],
        tools: ["filesystem", "git"],
        channels: ["general"],
      },
    ],
  });

  expect(team.getRole("frontend-engineer")?.name).toBe("frontend-engineer");
});
