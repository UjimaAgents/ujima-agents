import { DEFAULT_TOOL_CATALOG } from './constants.js';
import { DEFAULT_ROLE_TOOLS } from './roles/shared.js';

export const TEAM_CONFIG_VERSION = 3;

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
  'web_search',
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
  if (isLegacyDefaultRoleToolList(role.tools)) {
    return {
      ...role,
      tools: [...DEFAULT_ROLE_TOOLS],
    } as T;
  }
  return role;
}

function migrateToV3(config: Record<string, unknown>): Record<string, unknown> {
  const roles = Array.isArray(config.roles)
    ? config.roles.map((role) => (isRecord(role) ? upgradeLegacyDefaultRoleTools(role) : role))
    : config.roles;
  const tools = isRecord(config.tools)
    ? Object.fromEntries([...Object.entries(DEFAULT_TOOL_CATALOG), ...Object.entries(config.tools)])
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
  const upgraded = migrateToV3(config);
  const migrated =
    fromVersion < TEAM_CONFIG_VERSION ||
    needsToolCatalogUpgrade(config) ||
    JSON.stringify(config.roles ?? []) !== JSON.stringify(upgraded.roles ?? []) ||
    JSON.stringify(config.tools ?? {}) !== JSON.stringify(upgraded.tools ?? {});

  return {
    config: upgraded,
    migrated,
    fromVersion,
    toVersion: TEAM_CONFIG_VERSION,
  };
}
