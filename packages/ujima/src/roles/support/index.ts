import type { RolePreset } from '../../schemas.js';
import { supportAnalyticsReporter } from './support-analytics-reporter.js';
import { supportExecutiveSummaryGenerator } from './support-executive-summary-generator.js';
import { supportFinanceTracker } from './support-finance-tracker.js';
import { supportInfrastructureMaintainer } from './support-infrastructure-maintainer.js';
import { supportLegalComplianceChecker } from './support-legal-compliance-checker.js';
import { supportSupportResponder } from './support-support-responder.js';

export { supportAnalyticsReporter } from './support-analytics-reporter.js';
export { supportExecutiveSummaryGenerator } from './support-executive-summary-generator.js';
export { supportFinanceTracker } from './support-finance-tracker.js';
export { supportInfrastructureMaintainer } from './support-infrastructure-maintainer.js';
export { supportLegalComplianceChecker } from './support-legal-compliance-checker.js';
export { supportSupportResponder } from './support-support-responder.js';

export const Support_ROLE_PRESETS = {
  supportAnalyticsReporter,
  supportExecutiveSummaryGenerator,
  supportFinanceTracker,
  supportInfrastructureMaintainer,
  supportLegalComplianceChecker,
  supportSupportResponder,
} satisfies Record<string, RolePreset>;
