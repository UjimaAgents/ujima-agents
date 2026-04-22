import { PERSONALITY_PRESETS } from './constants.js';
import { PersonalityPresetSchema, type PersonalityPreset } from './schemas.js';

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

export function listPersonalityPresets(): PersonalityPreset[] {
  return Object.values(PERSONALITY_PRESETS).map((preset) => ({ ...preset }));
}

export function getPersonalityPreset(name: string): PersonalityPreset | undefined {
  return Object.entries(PERSONALITY_PRESETS).find(
    ([key, preset]) => key === name || preset.name === name,
  )?.[1];
}

export function createPersonalityFromPreset(
  name: string,
  overrides: Partial<PersonalityPreset> = {},
): PersonalityPreset {
  const preset = getPersonalityPreset(name);
  if (!preset) {
    throw new Error(`Unknown personality preset "${name}"`);
  }

  return definePersonality({
    ...preset,
    ...overrides,
    name: overrides.name ?? preset.name,
  });
}

export function definePersonality(personality: unknown): PersonalityPreset {
  const input = isRecord(personality) ? personality : {};
  return PersonalityPresetSchema.parse({
    ...input,
    title:
      typeof input.title === 'string'
        ? input.title
        : toTitle(typeof input.name === 'string' ? input.name : ''),
    description: typeof input.description === 'string' ? input.description : '',
    instructions: typeof input.instructions === 'string' ? input.instructions : '',
  });
}
