import { DEFAULT_TOOL_CATALOG } from './constants.js';
import { DEFAULT_ROLE_TOOLS } from './roles/shared.js';
import { DEPRECATED_TOOL_ALIASES, REMOVED_TOOL_IDS } from '@ujima/shared';

// Bumped from 3 → 4 to trigger the role-class default-fill migration.
// Bumped from 4 → 5 to seed skill.read into all existing roles' tool
// lists so the UI settings show it checked by default for every agent.
// skill.read is already in ALWAYS_AVAILABLE_AGENT_TOOLS on the
// orchestrator side, so it was always callable — this migration just
// makes it visible as "enabled" in the web UI.
export const TEAM_CONFIG_VERSION = 6;

// Role-class default tool sets. Used by the v4 migration to fill
// roles whose `tools` array is empty. The keys are matched
// case-insensitively against the role name via `inferRoleClass`.
//
// Design intent: every role gets read tools (also covered by
// ALWAYS_AVAILABLE_AGENT_TOOLS) plus class-appropriate write tools.
// `shell` is OFF for everyone by default — when an LLM hallucinates
// a tool call, the worst case of read is information disclosure
// (already gated by sensitive-path filter); the worst case of shell
// is arbitrary code execution.
const ROLE_CLASS_DEFAULT_TOOLS = {
  engineer: ['view', 'ls', 'glob', 'grep', 'edit', 'write', 'multiedit', 'fetch'],
  qa: ['view', 'ls', 'glob', 'grep', 'edit', 'write', 'multiedit'],
  pm: ['view', 'ls', 'glob', 'grep', 'edit', 'write', 'multiedit', 'web_search'],
  designer: ['view', 'ls', 'glob', 'grep', 'edit', 'write', 'multiedit'],
  analyst: ['view', 'ls', 'glob', 'grep', 'edit', 'write', 'web_search'],
  reviewer: ['view', 'ls', 'glob', 'grep'],
} as const;

type RoleClass = keyof typeof ROLE_CLASS_DEFAULT_TOOLS | 'unknown';

function inferRoleClass(roleName: string): RoleClass {
  const name = roleName.toLowerCase();
  if (/(engineer|developer|architect|devops|sre|coder|programmer)/.test(name)) {
    return 'engineer';
  }
  if (/(qa|quality|tester)/.test(name)) return 'qa';
  if (
    /(manager|project-manage|tracker|coordinator|chief-of-staff|product-owner|scrum)/.test(name)
  ) {
    return 'pm';
  }
  if (/(designer|ux|ui|graphic)/.test(name)) return 'designer';
  if (/(analyst|researcher|data-scien|insights)/.test(name)) return 'analyst';
  if (/(reviewer|auditor|observer|legal|compliance)/.test(name)) return 'reviewer';
  return 'unknown';
}

function defaultToolsForRoleClass(roleClass: RoleClass): readonly string[] | undefined {
  if (roleClass === 'unknown') return undefined;
  return ROLE_CLASS_DEFAULT_TOOLS[roleClass];
}

const LEGACY_DEFAULT_ROLE_TOOLS = [
  'filesystem',
  'shell',
  'message',
  'channel.post',
  'channel.reply',
  'channel.dm',
  'channel.list',
  'channel.read',
  'self.note',
  'mcp',
] as const;
const LEGACY_DEFAULT_ROLE_TOOL_SET = new Set<string>([
  ...LEGACY_DEFAULT_ROLE_TOOLS,
  'view',
  'write',
  'edit',
  'multiedit',
  'ls',
  'glob',
  'grep',
  'fetch',
  'download',
  'job_output',
  'job_kill',
  'web_search',
  'memory.save',
  'memory.write',
]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLegacyDefaultRoleToolList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= LEGACY_DEFAULT_ROLE_TOOLS.length &&
    value.every((item) => typeof item === 'string' && LEGACY_DEFAULT_ROLE_TOOL_SET.has(item)) &&
    LEGACY_DEFAULT_ROLE_TOOLS.every((tool) => value.includes(tool))
  );
}

export function upgradeLegacyDefaultRoleTools<T extends Record<string, unknown>>(role: T): T {
  if (!Array.isArray(role.tools)) return role;
  let tools = [...(role.tools as string[])];
  if (isLegacyDefaultRoleToolList(tools)) {
    tools = [...DEFAULT_ROLE_TOOLS];
  }
  tools = tools.filter((t) => !REMOVED_TOOL_IDS.has(t));
  tools = tools.map((t) => (DEPRECATED_TOOL_ALIASES as Record<string, string>)[t] ?? t);
  tools = [...new Set(tools)];
  return { ...role, tools } as T;
}

/**
 * V4 — fill empty `role.tools: []` arrays with a class-appropriate
 * write surface, and default empty `role.workspaceScopes: []` to
 * `['.']` for writer-class roles so the policy gate at
 * `policy.ts:168` doesn't reject every write path. Roles whose
 * tools are explicitly non-empty are untouched.
 *
 * The user can still narrow back to `[]` via the settings UI — the
 * migration only fires on the initial config-bump from v3 → v4.
 */
export function fillEmptyRoleToolsByClass<T extends Record<string, unknown>>(role: T): T {
  if (!isRecord(role)) return role;
  const tools = role.tools;
  if (!Array.isArray(tools) || tools.length > 0) return role;
  const roleName = typeof role.name === 'string' ? role.name : '';
  const classDefaults = defaultToolsForRoleClass(inferRoleClass(roleName));
  if (!classDefaults) return role;
  const scopes = Array.isArray(role.workspaceScopes) ? role.workspaceScopes : [];
  const needsScope = classDefaults.some((tool) =>
    ['edit', 'write', 'multiedit', 'shell'].includes(tool),
  );
  return {
    ...role,
    tools: [...classDefaults],
    ...(scopes.length === 0 && needsScope ? { workspaceScopes: ['.'] } : {}),
  } as T;
}

function migrateToV3(config: Record<string, unknown>): Record<string, unknown> {
  const roles = Array.isArray(config.roles)
    ? config.roles.map((role) => (isRecord(role) ? upgradeLegacyDefaultRoleTools(role) : role))
    : config.roles;
  const tools = isRecord(config.tools)
    ? (() => {
        const toolEntries = Object.entries(config.tools).filter(
          ([toolName]) => toolName !== 'memory.save',
        );
        const legacyMemorySave = config.tools['memory.save'];
        const entries = [
          ...Object.entries(DEFAULT_TOOL_CATALOG),
          ...toolEntries,
        ];
        if (legacyMemorySave !== undefined && !('memory.write' in config.tools)) {
          entries.push(['memory.write', legacyMemorySave]);
        }
        return Object.fromEntries(
          entries.filter(([toolName]) => !REMOVED_TOOL_IDS.has(toolName)),
        );
      })()
    : DEFAULT_TOOL_CATALOG;

  return {
    ...config,
    configVersion: TEAM_CONFIG_VERSION,
    roles,
    tools,
  };
}

function migrateToV4(config: Record<string, unknown>): Record<string, unknown> {
  const roles = Array.isArray(config.roles)
    ? config.roles.map((role) => (isRecord(role) ? fillEmptyRoleToolsByClass(role) : role))
    : config.roles;
  return {
    ...config,
    configVersion: TEAM_CONFIG_VERSION,
    roles,
  };
}

/**
 * V5 — seed `skill.read` into every role's `tools` array if it isn't
 * already present.  Since `skill.read` is already gated as a baseline
 * tool in `ALWAYS_AVAILABLE_AGENT_TOOLS` on the orchestrator side,
 * agents could already call it; this migration makes the web UI show
 * it as checked/enabled for all existing roles.
 */
function migrateToV5(config: Record<string, unknown>): Record<string, unknown> {
  const roles = Array.isArray(config.roles)
    ? config.roles.map((role) => {
        if (!isRecord(role)) return role;
        const tools = Array.isArray(role.tools) ? [...role.tools] : [];
        if (!tools.includes('skill.read')) {
          tools.push('skill.read');
        }
        return { ...role, tools };
      })
    : config.roles;
  return {
    ...config,
    configVersion: TEAM_CONFIG_VERSION,
    roles,
  };
}

/**
 * V6 — re-apply the registry-driven tool upgrade and strip removed
 * tool catalog entries. Guarantees configs that went through V3-V5
 * with older migration logic get the new generic treatment.
 */
function migrateToV6(config: Record<string, unknown>): Record<string, unknown> {
  const roles = Array.isArray(config.roles)
    ? config.roles.map((role) => (isRecord(role) ? upgradeLegacyDefaultRoleTools(role) : role))
    : config.roles;
  const tools = isRecord(config.tools)
    ? Object.fromEntries(
        Object.entries(config.tools as Record<string, unknown>).filter(
          ([toolName]) => !REMOVED_TOOL_IDS.has(toolName),
        ),
      )
    : DEFAULT_TOOL_CATALOG;
  return {
    ...config,
    configVersion: TEAM_CONFIG_VERSION,
    roles,
    tools,
  };
}

function needsToolCatalogUpgrade(config: Record<string, unknown>): boolean {
  if (!isRecord(config.tools)) return true;
  const tools = config.tools as Record<string, unknown>;
  return Object.keys(DEFAULT_TOOL_CATALOG).some((toolName) => !tools[toolName]);
}

export interface TeamConfigMigrationResult {
  config: Record<string, unknown>;
  migrated: boolean;
  fromVersion: number;
  toVersion: number;
}

export function migrateAgentTeamConfig(input: unknown): TeamConfigMigrationResult {
  const config = isRecord(input) ? { ...input } : {};
  const fromVersion = typeof config.configVersion === 'number' ? config.configVersion : 1;
  // Chain v3 → v4 → v5 → v6 — v3 ensures the tool catalog and
  // legacy-tool mapping is in place; v4 layers the role-class default
  // fill on top of the result; v5 seeds skill.read into every role's
  // tools; v6 strips removed tools.
  const afterV3 = migrateToV3(config);
  const afterV4 = migrateToV4(afterV3);
  const afterV5 = migrateToV5(afterV4);
  const afterV6 = migrateToV6(afterV5);
  const migrated =
    fromVersion < TEAM_CONFIG_VERSION ||
    needsToolCatalogUpgrade(config) ||
    JSON.stringify(config.roles ?? []) !== JSON.stringify(afterV6.roles ?? []) ||
    JSON.stringify(config.tools ?? {}) !== JSON.stringify(afterV6.tools ?? {});

  return {
    config: afterV6,
    migrated,
    fromVersion,
    toVersion: TEAM_CONFIG_VERSION,
  };
}
