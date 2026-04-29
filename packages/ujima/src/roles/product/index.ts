import type { RolePreset } from '../../schemas.js';
import { pm } from './pm.js';
import { productBehavioralNudgeEngine } from './product-behavioral-nudge-engine.js';
import { productFeedbackSynthesizer } from './product-feedback-synthesizer.js';
import { productManager } from './product-manager.js';
import { productSprintPrioritizer } from './product-sprint-prioritizer.js';
import { productTrendResearcher } from './product-trend-researcher.js';

export { pm } from './pm.js';
export { productBehavioralNudgeEngine } from './product-behavioral-nudge-engine.js';
export { productFeedbackSynthesizer } from './product-feedback-synthesizer.js';
export { productManager } from './product-manager.js';
export { productSprintPrioritizer } from './product-sprint-prioritizer.js';
export { productTrendResearcher } from './product-trend-researcher.js';

export const Product_ROLE_PRESETS = {
  pm,
  productBehavioralNudgeEngine,
  productFeedbackSynthesizer,
  productManager,
  productSprintPrioritizer,
  productTrendResearcher,
} satisfies Record<string, RolePreset>;
