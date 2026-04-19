import { expect, test } from "bun:test";
import { AgentTeam } from "@ujima/framework";
import { checkToolPolicy } from "./policy.ts";

const team = AgentTeam({
  name: "Test Team",
  workspace: {
    root: "/tmp/ujima-test",
    roleScopes: {
      "frontend-engineer": ["apps/web"],
    },
  },
  providers: {
    openai: {
      defaultModel: "gpt-5.4",
      models: ["gpt-5.4"],
    },
  },
  roles: [
    {
      name: "frontend-engineer",
      title: "Frontend Engineer",
      instructions: "Build the UI.",
      provider: "openai",
      model: "gpt-5.4",
      workspaceScopes: ["apps/web"],
      tools: ["filesystem", "git"],
      channels: ["general"],
    },
  ],
  channels: [
    {
      name: "general",
      kind: "general",
      topic: "",
      memberIds: [],
    },
  ],
});

test("policy blocks unknown tools and out-of-scope paths", () => {
  expect(checkToolPolicy(team, "frontend-engineer", "shell", "execute", "/tmp/ujima-test/apps/web")).toMatchObject({
    allowed: false,
  });

  expect(checkToolPolicy(team, "frontend-engineer", "filesystem", "read", "/tmp/other")).toMatchObject({
    allowed: false,
  });
});

test("policy allows scoped read and flags writes for approval", () => {
  expect(
    checkToolPolicy(team, "frontend-engineer", "filesystem", "read", "/tmp/ujima-test/apps/web/src/app.ts"),
  ).toMatchObject({
    allowed: true,
    requiresApproval: false,
  });

  expect(
    checkToolPolicy(team, "frontend-engineer", "filesystem", "write", "/tmp/ujima-test/apps/web/src/app.ts"),
  ).toMatchObject({
    allowed: true,
    requiresApproval: true,
  });
});

