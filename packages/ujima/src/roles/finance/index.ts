import type { RolePreset } from '../../schemas.js';
import { financeBookkeeperController } from './finance-bookkeeper-controller.js';
import { financeFinancialAnalyst } from './finance-financial-analyst.js';
import { financeFpaAnalyst } from './finance-fpa-analyst.js';
import { financeInvestmentResearcher } from './finance-investment-researcher.js';
import { financeTaxStrategist } from './finance-tax-strategist.js';

export { financeBookkeeperController } from './finance-bookkeeper-controller.js';
export { financeFinancialAnalyst } from './finance-financial-analyst.js';
export { financeFpaAnalyst } from './finance-fpa-analyst.js';
export { financeInvestmentResearcher } from './finance-investment-researcher.js';
export { financeTaxStrategist } from './finance-tax-strategist.js';

export const Finance_ROLE_PRESETS = {
  financeBookkeeperController,
  financeFinancialAnalyst,
  financeFpaAnalyst,
  financeInvestmentResearcher,
  financeTaxStrategist,
} satisfies Record<string, RolePreset>;
