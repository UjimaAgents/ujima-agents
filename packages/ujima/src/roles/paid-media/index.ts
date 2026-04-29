import type { RolePreset } from '../../schemas.js';
import { paidMediaAuditor } from './paid-media-auditor.js';
import { paidMediaCreativeStrategist } from './paid-media-creative-strategist.js';
import { paidMediaPaidSocialStrategist } from './paid-media-paid-social-strategist.js';
import { paidMediaPpcStrategist } from './paid-media-ppc-strategist.js';
import { paidMediaProgrammaticBuyer } from './paid-media-programmatic-buyer.js';
import { paidMediaSearchQueryAnalyst } from './paid-media-search-query-analyst.js';
import { paidMediaTrackingSpecialist } from './paid-media-tracking-specialist.js';

export { paidMediaAuditor } from './paid-media-auditor.js';
export { paidMediaCreativeStrategist } from './paid-media-creative-strategist.js';
export { paidMediaPaidSocialStrategist } from './paid-media-paid-social-strategist.js';
export { paidMediaPpcStrategist } from './paid-media-ppc-strategist.js';
export { paidMediaProgrammaticBuyer } from './paid-media-programmatic-buyer.js';
export { paidMediaSearchQueryAnalyst } from './paid-media-search-query-analyst.js';
export { paidMediaTrackingSpecialist } from './paid-media-tracking-specialist.js';

export const PaidMedia_ROLE_PRESETS = {
  paidMediaAuditor,
  paidMediaCreativeStrategist,
  paidMediaPaidSocialStrategist,
  paidMediaPpcStrategist,
  paidMediaProgrammaticBuyer,
  paidMediaSearchQueryAnalyst,
  paidMediaTrackingSpecialist,
} satisfies Record<string, RolePreset>;
