import type { RolePreset } from '../../schemas.js';
import { salesAccountStrategist } from './sales-account-strategist.js';
import { salesCoach } from './sales-coach.js';
import { salesDealStrategist } from './sales-deal-strategist.js';
import { salesDiscoveryCoach } from './sales-discovery-coach.js';
import { salesEngineer } from './sales-engineer.js';
import { salesOutboundStrategist } from './sales-outbound-strategist.js';
import { salesPipelineAnalyst } from './sales-pipeline-analyst.js';
import { salesProposalStrategist } from './sales-proposal-strategist.js';

export { salesAccountStrategist } from './sales-account-strategist.js';
export { salesCoach } from './sales-coach.js';
export { salesDealStrategist } from './sales-deal-strategist.js';
export { salesDiscoveryCoach } from './sales-discovery-coach.js';
export { salesEngineer } from './sales-engineer.js';
export { salesOutboundStrategist } from './sales-outbound-strategist.js';
export { salesPipelineAnalyst } from './sales-pipeline-analyst.js';
export { salesProposalStrategist } from './sales-proposal-strategist.js';

export const Sales_ROLE_PRESETS = {
  salesAccountStrategist,
  salesCoach,
  salesDealStrategist,
  salesDiscoveryCoach,
  salesEngineer,
  salesOutboundStrategist,
  salesPipelineAnalyst,
  salesProposalStrategist,
} satisfies Record<string, RolePreset>;
