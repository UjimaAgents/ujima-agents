import type { RolePreset } from '../../schemas.js';
import { designBrandGuardian } from './design-brand-guardian.js';
import { designImagePromptEngineer } from './design-image-prompt-engineer.js';
import { designInclusiveVisualsSpecialist } from './design-inclusive-visuals-specialist.js';
import { designUiDesigner } from './design-ui-designer.js';
import { designUxArchitect } from './design-ux-architect.js';
import { designUxResearcher } from './design-ux-researcher.js';
import { designVisualStoryteller } from './design-visual-storyteller.js';
import { designWhimsyInjector } from './design-whimsy-injector.js';

export { designBrandGuardian } from './design-brand-guardian.js';
export { designImagePromptEngineer } from './design-image-prompt-engineer.js';
export { designInclusiveVisualsSpecialist } from './design-inclusive-visuals-specialist.js';
export { designUiDesigner } from './design-ui-designer.js';
export { designUxArchitect } from './design-ux-architect.js';
export { designUxResearcher } from './design-ux-researcher.js';
export { designVisualStoryteller } from './design-visual-storyteller.js';
export { designWhimsyInjector } from './design-whimsy-injector.js';

export const Design_ROLE_PRESETS = {
  designBrandGuardian,
  designImagePromptEngineer,
  designInclusiveVisualsSpecialist,
  designUiDesigner,
  designUxArchitect,
  designUxResearcher,
  designVisualStoryteller,
  designWhimsyInjector,
} satisfies Record<string, RolePreset>;
