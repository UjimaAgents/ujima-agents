# `@ujima/framework`

A framework SDK for defining Agent teams in code.

This is the package you install when you want to create an organization, declare agent roles, assign tools, bind providers, and load a team definition into the local backend.

## Install

```bash
bun add @ujima/framework
```

In this monorepo:

```bash
bun install
```

## Import

```ts
import {
  AgentTeam,
  createStarterAgentTeamConfig,
  createRoleFromPreset,
  defineRole,
  defineTool,
  defineProvider,
  loadAgentTeam,
  loadAgentTeamFromFile,
  ROLE_PRESETS,
  DEFAULT_TOOL_CATALOG,
} from "@ujima/framework";
```

## Quick Start

```ts
import {AgentTeam} from "@ujima/framework";

const team = AgentTeam({
  name: "Acme Team",
  workspace: {
    root: "/Users/me/acme",
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
      instructions: "Build and polish the UI.",
      provider: "openai",
      model: "gpt-4.1-mini",
      workspaceScopes: ["apps/web"],
      tools: ["filesystem", "git"],
      channels: ["general"],
    },
  ],
});
```

## What This Package Gives Users

- a typed `AgentTeam(...)` entrypoint
- starter presets for common engineering roles
- helper factories for providers, tools, and roles
- config normalization and validation
- workspace-aware team loading
- defaults for the local tool catalog

## Public API

### Team API

- `AgentTeam(config)`
- `createStarterAgentTeamConfig(options?)`
- `loadAgentTeam(config)`
- `loadAgentTeamFromFile(filePath)`

`AgentTeam()` returns a handle with:

- `kind`
- `config`
- `workspace`
- `providers`
- `roles`
- `channels`
- `tools`
- `getRole(name)`
- `getChannel(name)`
- `getProvider(name)`
- `toJSON()`

Example:

```ts
import {AgentTeam} from "@ujima/framework";

const team = AgentTeam({
  name: "Acme Team",
  workspace: {
    root: "/Users/me/acme",
    roleScopes: {},
  },
  providers: {},
  roles: [
    {
      name: "pm",
      title: "Product Manager",
      instructions: "Keep the team aligned.",
      workspaceScopes: ["."],
      tools: ["filesystem"],
      channels: ["general"],
    },
  ],
});

console.log(team.getRole("pm"));
```

### Role Helpers

- `ROLE_PRESETS`
- `listRolePresets()`
- `getRolePreset(name)`
- `createRoleFromPreset(name, overrides?)`
- `defineRole(role)`
- `normalizeRoles(roles, workspaceRoot)`

Example:

```ts
import {createRoleFromPreset} from "@ujima/framework";

const frontendEngineer = createRoleFromPreset("frontendEngineer", {
  provider: "openai",
  model: "gpt-4.1-mini",
});
```

### Provider Helpers

- `defineProvider(provider)`
- `normalizeProviders(providers)`

### Tool Helpers

- `DEFAULT_TOOL_CATALOG`
- `defineTool(tool)`
- `normalizeTools(tools)`
- `listDefaultToolNames()`

### Workspace Helpers

- `createWorkspaceConfig(root, roleScopes?)`
- `normalizeWorkspaceRoot(root)`
- `normalizeRoleScopes(roleScopes, root)`
- `resolveWorkspacePath(root, relativePath?)`
- `assertWorkspaceBoundary(root, candidatePath)`

### Schemas

The framework package also exports the typed config schemas:

- `ProviderConfigSchema`
- `PolicySchema`
- `RolePresetSchema`
- `RoleConfigSchema`
- `ChannelConfigSchema`
- `AgentTeamConfigSchema`

And their inferred TypeScript types:

- `ProviderConfig`
- `PolicyConfig`
- `RolePreset`
- `RoleConfig`
- `ChannelConfig`
- `AgentTeamConfig`
- `AgentTeamConfigInput`

## Configuration Rules

- `workspace.root` is required.
- `roles` must not be empty.
- channels referenced by a role must exist.
- providers referenced by a role must exist.
- tools referenced by a role must exist.
- workspace scopes are normalized against the workspace root.
- the workspace root is treated as a hard boundary.

## Testing

```bash
bun test packages/ujima/index.test.ts
```

## Loading Teams From Files

Use `loadAgentTeamFromFile()` when you want to load a JSON or ESM config file:

```ts
import {loadAgentTeamFromFile} from "@ujima/framework";

const team = await loadAgentTeamFromFile("./ujima.team.json");
```

## Notes For App Authors

- Keep this package as the canonical team-definition surface.
- Let the API consume this package rather than duplicating its rules.
- Prefer explicit config over builder magic.
- Keep path safety and role validation strict.
