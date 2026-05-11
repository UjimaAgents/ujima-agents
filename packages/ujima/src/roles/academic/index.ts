import type { RolePreset } from '../../schemas.js';
import { academicAnthropologist } from './academic-anthropologist.js';
import { academicGeographer } from './academic-geographer.js';
import { academicHistorian } from './academic-historian.js';
import { academicNarratologist } from './academic-narratologist.js';
import { academicPsychologist } from './academic-psychologist.js';

export { academicAnthropologist } from './academic-anthropologist.js';
export { academicGeographer } from './academic-geographer.js';
export { academicHistorian } from './academic-historian.js';
export { academicNarratologist } from './academic-narratologist.js';
export { academicPsychologist } from './academic-psychologist.js';

export const Academic_ROLE_PRESETS = {
  academicAnthropologist,
  academicGeographer,
  academicHistorian,
  academicNarratologist,
  academicPsychologist,
} satisfies Record<string, RolePreset>;
