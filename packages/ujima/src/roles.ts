import { resolveWorkspacePath } from '@ujima/shared/workspace';
import { ROLE_INDUSTRY_PRESETS, ROLE_PRESETS, STARTER_ROLE_PRESET_KEYS } from './roles/index.js';
import { RoleConfigSchema, type RoleConfig, type RolePreset } from './schemas.js';
import { getSkillInstructions } from './skills.js';
import { normalizeProviderKey } from './providers.js';

function toTitle(name: string): string {
  return name
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface RoleIndustryPreset extends RolePreset {
  industry: string;
  key: string;
}

export interface RoleIndustryCatalog {
  industry: string;
  presets: RoleIndustryPreset[];
}

export function listRolePresets(): RolePreset[] {
  return Object.values(ROLE_PRESETS).map((preset) => ({ ...preset }));
}

export function listStarterRolePresets(): RolePreset[] {
  return STARTER_ROLE_PRESET_KEYS.map((key) => ({ ...ROLE_PRESETS[key] }));
}

export function listRoleIndustries(): RoleIndustryCatalog[] {
  return Object.entries(ROLE_INDUSTRY_PRESETS).map(([industry, presets]) => ({
    industry,
    presets: Object.entries(presets).map(([key, preset]) => ({
      industry,
      key,
      ...preset,
    })),
  }));
}

export function getRolePreset(name: string): RolePreset | undefined {
  return Object.entries(ROLE_PRESETS).find(([key, preset]) => key === name || preset.name === name)?.[1];
}

export function createRoleFromPreset(
  name: string,
  overrides: Partial<RoleConfig> = {},
): RoleConfig {
  const preset = getRolePreset(name);
  if (!preset) {
    throw new Error(`Unknown role preset "${name}"`);
  }

  return defineRole({
    ...preset,
    ...overrides,
    id: overrides.id ?? preset.name,
    kind: overrides.kind ?? 'agent',
  });
}

export function defineRole(role: unknown): RoleConfig {
  const input = isRecord(role) ? role : {};
  const parsed: RoleConfig = RoleConfigSchema.parse({
    ...input,
    title:
      typeof input.title === 'string'
        ? input.title
        : toTitle(typeof input.name === 'string' ? input.name : ''),
    description: typeof input.description === 'string' ? input.description : '',
    kind: typeof input.kind === 'string' ? input.kind : 'agent',
  });

  return {
    ...parsed,
    provider: parsed.provider ? normalizeProviderKey(parsed.provider) : undefined,
  };
}

export function normalizeRoles(roles: unknown[] = [], workspaceRoot: string): RoleConfig[] {
  return roles.map((role) => {
    const parsed = defineRole(role);
    const skillInstructions = getSkillInstructions(parsed);
    const instructions = skillInstructions
      ? `${parsed.instructions}${skillInstructions}`
      : parsed.instructions;

    return {
      ...parsed,
      instructions,
      workspaceScopes: parsed.workspaceScopes.map((scope) =>
        resolveWorkspacePath(workspaceRoot, scope),
      ),
    };
  });
}
