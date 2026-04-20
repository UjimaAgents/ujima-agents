# `@ujima/framework`

A framework SDK for defining Agent teams in code.

This is the package you install when you want to create an organization, declare agent roles, assign tools, bind providers, and load a team definition into the local backend.

## 📦 Install

```bash
bun add @ujima/framework
```

In this monorepo:

```bash
bun install
```

## 🔌 Import

```ts
import {
  AgentTeam,
  createStarterAgentTeamConfig,
  loadAgentTeamFromFile,
  ROLE_PRESETS,
  PERSONALITY_PRESETS,
  DEFAULT_TOOL_CATALOG,
} from "@ujima/framework";
```

## ⚡ Quick Start

```ts
import { AgentTeam } from "@ujima/framework";

const pmRole = {
  name: "product",
  title: "Product Manager",
  instructions: "Keep the team aligned.",
  workspaceScopes: ["."],
  tools: ["filesystem", "shell", "message"],
  skills: ["product-marketing-context", "analytics-tracking"],
  channels: ["general"],
};

const frontendRole = {
  name: "frontend",
  title: "Frontend Engineer",
  instructions: "Build and polish the UI.",
  provider: "openai",
  model: "gpt-5.4",
  workspaceScopes: ["apps/web"],
  tools: ["filesystem", "shell", "message"],
  skills: ["react-best-practices", "terminal-ui"],
  channels: ["general"],
};

const backendRole = {
  name: "backend",
  title: "Backend Engineer",
  instructions: "Keep the backend simple and secure.",
  provider: "openai",
  model: "gpt-5.4",
  workspaceScopes: ["apps/api"],
  tools: ["filesystem", "shell", "message"],
  skills: ["terminal-ui"],
  channels: ["general"],
};

const team = AgentTeam({
  name: "Acme Team",
  // Workspace defaults to the current directory if omitted
  // workspace: { root: "." },
  roles: [pmRole, frontendRole, backendRole],
  
  // Agents can be defined cleanly using simple inline objects
  agents: [
    { name: "Taylor Morgan", roleName: "product", personalityName: "direct" },
    { name: "Sam Patel", roleName: "frontend", personalityName: "thoughtful" },
    { name: "Alice Nguyen", roleName: "frontend", personalityName: "skeptical" },
    { name: "Priya Shah", roleName: "backend", personalityName: "precise" },
  ],
  
  // Organization charts are natively understood and validated
  organizationChart: {
    reportsTo: {
      "Sam Patel": "Taylor Morgan",
      "Alice Nguyen": "Taylor Morgan",
      "Priya Shah": "Taylor Morgan",
    }
  },
  
  providers: {
    openai: {
      defaultModel: "gpt-5.4",
      models: ["gpt-5.4"],
    },
  },
});
```

## 🧠 What This Package Gives Users

- a typed `AgentTeam(...)` entrypoint
- starter presets for common engineering roles and personalities
- helper factories for providers, tools, roles, and prompt composition
- config normalization and validation
- workspace-aware team loading
- defaults for the local tool catalog
- named agent definitions and org-chart validation at the framework layer

## 🧩 Public API

### 👥 Team API

- **`AgentTeam(config)`**: The primary declarative entry point. Validates, normalizes, and packages your raw team configuration object into a verified handle for the API.
- **`createStarterAgentTeamConfig(options?)`**: Generates a high-quality boilerplate configuration for a new organization, including starter roles, agents, and personality presets.
- **`loadAgentTeam(config)`**: A lightweight alias to `AgentTeam(config)` for semantic clarity in loader pipelines.
- **`loadAgentTeamFromFile(filePath)`**: Dynamically loads and resolves a team configuration from `.json`, `.js`, or `.ts` files and returns a validated handle.

`AgentTeam()` returns a handle with:

- `kind`, `config`, `workspace`, `organizationChart`, `agents`, `providers`, `roles`, `channels`, `tools`
- `getAgent(name)`: Retrieves a named agent by name.
- `getRole(name)`: Retrieves a normalized role by name or ID.
- `getChannel(name)`: Retrieves a normalized channel by name or ID.
- `getProvider(name)`: Retrieves provider configuration by name.
- `toJSON()`: Returns the normalized configuration object.

Example:

```ts
import { AgentTeam } from "@ujima/framework";

const team = AgentTeam({
  name: "Acme Team",
  // Workspace is optional and defaults to the current working directory.
  // Using explicit configuration dynamically enforces safe module path boundaries.
  workspace: {
    root: process.cwd(),
    roleScopes: {
      frontend: ["apps/web"],
    },
  },
  organizationChart: {
    reportsTo: {
      "Sam Patel": "Taylor Morgan",
      "Alice Nguyen": "Taylor Morgan",
    }
  },
  agents: [
    { name: "Taylor Morgan", roleName: "product", personalityName: "direct" },
    { name: "Sam Patel", roleName: "frontend", personalityName: "thoughtful" },
    { name: "Alice Nguyen", roleName: "frontend", personalityName: "skeptical" },
  ],
  providers: {
    openai: {
      defaultModel: "gpt-5.4",
      models: ["gpt-5.4"],
    },
  },
  roles: [
    {
      name: "product",
      title: "Product Manager",
      instructions: "Keep the team aligned and moving.",
      workspaceScopes: ["."],
      tools: ["filesystem", "message"],
      skills: ["product-marketing-context"],
      channels: ["general"],
    },
    {
      name: "frontend",
      title: "Frontend Engineer",
      instructions: "Build and polish the UI.",
      provider: "openai",
      model: "gpt-5.4",
      workspaceScopes: ["apps/web"],
      tools: ["filesystem", "shell", "message"],
      skills: ["react-best-practices"],
      channels: ["general"],
    },
  ],
});

console.log(team.getRole("pm"));
console.log(team.getAgent("Sam Patel"));
```

### 🎭 Role Helpers

- **`ROLE_PRESETS`**: The raw catalog of pre-configured agent roles (Frontend, Backend, PM, etc.).
- **`listRolePresets()`**: Returns the full catalog of role blueprints available in the framework.
- **`getRolePreset(name)`**: Retrieves a specific role blueprint by its identifier (e.g., 'frontendEngineer').
- **`createRoleFromPreset(name, overrides?)`**: Instantiates a role with standard instructions, while allowing overrides for models or tools.
- **`defineRole(role)`**: Validates and normalizes a custom role object against the internal `RoleConfigSchema`.
- **`normalizeRoles(roles, workspaceRoot)`**: Mass-normalizes an array of roles and resolves their workspace scopes against the root.

### 🧍 Agent Helpers

- **`PERSONALITY_PRESETS`**: The raw catalog of personality blueprints available in the framework.
- **`listPersonalityPresets()`**: Returns the full catalog of personality blueprints.
- **`getPersonalityPreset(name)`**: Retrieves a specific personality blueprint by its identifier.
- **`createPersonalityFromPreset(name, overrides?)`**: Instantiates a personality preset with standard instructions, while allowing overrides.
- **`definePersonality(personality)`**: Validates and normalizes a custom personality object against the internal `PersonalityPresetSchema`.
- **`createAgent(name, roleName, personalityName?)`**: Creates a named agent instance with a role and personality preset.
- **`normalizeAgents(agents, roles)`**: Normalizes named agents and validates that names are unique, roles exist, and personalities exist.

Example:

```ts
import {createRoleFromPreset} from "@ujima/framework";

const frontendEngineer = createRoleFromPreset("frontendEngineer", {
  provider: "openai",
  model: "gpt-5.4",
});
```

### ☁️ Provider Helpers

- **`defineProvider(provider)`**: A type-safe helper to wrap provider configurations (models and model selection).
- **`normalizeProviders(providers)`**: Validates and applies defaults to a map of provider configurations.

### 🧰 Tool Helpers

- **`DEFAULT_TOOL_CATALOG`**: The standard set of tools available locally (filesystem, shell, message, mcp).
- **`defineTool(tool)`**: Validates a tool capability structure, ensuring actions and path-restrictions are correctly formatted.
- **`normalizeTools(tools)`**: Validates a map of tool definitions and merges them with defaults.
- **`listDefaultToolNames()`**: Convenience utility to see all tools available in the standard local catalog.

### 🧭 Workspace Helpers

- **`createWorkspaceConfig(root, roleScopes?)`**: Formalizes the relationship between the organization's hard filesystem boundary and role sub-access.
- **`normalizeWorkspaceRoot(root)`**: Resolves relative paths into absolute machine-safe paths.
- **`normalizeRoleScopes(roleScopes, root)`**: Ensures all role-specific path restrictions resolve correctly within the root.
- **`resolveWorkspacePath(root, relativePath?)`**: Securely resolves a path while ensuring it never escapes the workspace root.
- **`assertWorkspaceBoundary(root, candidatePath)`**: A strict security check that throws if a path attempts to break out of the sandbox.

### 🧪 Skills (SKILL.md)

- **`getSkillInstructions(role)`**: Generates the specialized instruction block used to point agents toward their `.ujima/skills` directory at runtime.

### 🧷 Schemas

The framework package exports the underlying Zod schemas and their TypeScript types:

- **Schemas**: `ProviderConfigSchema`, `PolicySchema`, `PersonalityPresetSchema`, `RolePresetSchema`, `RoleConfigSchema`, `AgentConfigSchema`, `ChannelConfigSchema`, `AgentTeamConfigSchema`.
- **Types**: `ProviderConfig`, `PolicyConfig`, `PersonalityPreset`, `RolePreset`, `RoleConfig`, `AgentConfig`, `ChannelConfig`, `AgentTeamConfig`, `AgentTeamConfigInput`.

## ✅ Configuration Rules

- `workspace.root` defaults to the current working directory if omitted.
- `roles` must not be empty.
- `agents` must have unique names.
- Channels, providers, and tools referenced by a role must exist.
- Workspace scopes are normalized against the workspace root.
- The workspace root is treated as a hard boundary for all operations.
- `organizationChart` can be defined directly in the team config, and its reporting lines are automatically validated.
- Each agent can select a different personality preset.
- Shell is the execution path for git commands.
- Messaging is a first-class tool for threads, channels, and DMs.

## 🧪 Testing

```bash
bun test packages/ujima/index.test.ts
```

## 📄 Loading Teams From Files

Use `loadAgentTeamFromFile()` to load a JSON or ESM config file:

```ts
import {loadAgentTeamFromFile} from "@ujima/framework";

const team = await loadAgentTeamFromFile("./ujima.team.json");
```

## 📝 Notes For App Authors

- Keep this package as the canonical team-definition surface.
- Let the API consume this package rather than duplicating its rules.
- Path safety and role validation are hard-enforced at the framework level.
