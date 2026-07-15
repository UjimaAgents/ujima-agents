import type { RolePreset } from '../schemas.js';
import { Academic_ROLE_PRESETS } from './academic/index.js';
import { Design_ROLE_PRESETS } from './design/index.js';
import { Engineering_ROLE_PRESETS } from './engineering/index.js';
import { Finance_ROLE_PRESETS } from './finance/index.js';
import { GameDevelopment_ROLE_PRESETS } from './game-development/index.js';
import { Marketing_ROLE_PRESETS } from './marketing/index.js';
import { PaidMedia_ROLE_PRESETS } from './paid-media/index.js';
import { Product_ROLE_PRESETS } from './product/index.js';
import { ProjectManagement_ROLE_PRESETS } from './project-management/index.js';
import { Sales_ROLE_PRESETS } from './sales/index.js';
import { SpatialComputing_ROLE_PRESETS } from './spatial-computing/index.js';
import { Specialized_ROLE_PRESETS } from './specialized/index.js';
import { Support_ROLE_PRESETS } from './support/index.js';
import { Testing_ROLE_PRESETS } from './testing/index.js';

export const STARTER_ROLE_PRESET_KEYS = [
  "hr",
  "frontendEngineer",
  "backendEngineer",
  "pm",
  "codeReviewer",
  "engineeringManager",
  "qaEngineer"
] as const;

export const ROLE_PRESETS = {
  ...Academic_ROLE_PRESETS,
  ...Design_ROLE_PRESETS,
  ...Engineering_ROLE_PRESETS,
  ...Finance_ROLE_PRESETS,
  ...GameDevelopment_ROLE_PRESETS,
  ...Marketing_ROLE_PRESETS,
  ...PaidMedia_ROLE_PRESETS,
  ...Product_ROLE_PRESETS,
  ...ProjectManagement_ROLE_PRESETS,
  ...Sales_ROLE_PRESETS,
  ...SpatialComputing_ROLE_PRESETS,
  ...Specialized_ROLE_PRESETS,
  ...Support_ROLE_PRESETS,
  ...Testing_ROLE_PRESETS,
} satisfies Record<string, RolePreset>;

export const ROLE_INDUSTRY_PRESETS = {
  academic: Academic_ROLE_PRESETS,
  design: Design_ROLE_PRESETS,
  engineering: Engineering_ROLE_PRESETS,
  finance: Finance_ROLE_PRESETS,
  'game-development': GameDevelopment_ROLE_PRESETS,
  marketing: Marketing_ROLE_PRESETS,
  'paid-media': PaidMedia_ROLE_PRESETS,
  product: Product_ROLE_PRESETS,
  'project-management': ProjectManagement_ROLE_PRESETS,
  sales: Sales_ROLE_PRESETS,
  'spatial-computing': SpatialComputing_ROLE_PRESETS,
  specialized: Specialized_ROLE_PRESETS,
  support: Support_ROLE_PRESETS,
  testing: Testing_ROLE_PRESETS,
} as const;

export const STARTER_ROLE_PRESETS = STARTER_ROLE_PRESET_KEYS.map(
  (key) => ROLE_PRESETS[key],
) as RolePreset[];
