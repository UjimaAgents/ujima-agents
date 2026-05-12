import type { RolePreset } from '../../schemas.js';
import { qaEngineer } from './qa-engineer.js';
import { testingAccessibilityAuditor } from './testing-accessibility-auditor.js';
import { testingApiTester } from './testing-api-tester.js';
import { testingEvidenceCollector } from './testing-evidence-collector.js';
import { testingPerformanceBenchmarker } from './testing-performance-benchmarker.js';
import { testingRealityChecker } from './testing-reality-checker.js';
import { testingTestResultsAnalyzer } from './testing-test-results-analyzer.js';
import { testingToolEvaluator } from './testing-tool-evaluator.js';
import { testingWorkflowOptimizer } from './testing-workflow-optimizer.js';

export { qaEngineer } from './qa-engineer.js';
export { testingAccessibilityAuditor } from './testing-accessibility-auditor.js';
export { testingApiTester } from './testing-api-tester.js';
export { testingEvidenceCollector } from './testing-evidence-collector.js';
export { testingPerformanceBenchmarker } from './testing-performance-benchmarker.js';
export { testingRealityChecker } from './testing-reality-checker.js';
export { testingTestResultsAnalyzer } from './testing-test-results-analyzer.js';
export { testingToolEvaluator } from './testing-tool-evaluator.js';
export { testingWorkflowOptimizer } from './testing-workflow-optimizer.js';

export const Testing_ROLE_PRESETS = {
  qaEngineer,
  testingAccessibilityAuditor,
  testingApiTester,
  testingEvidenceCollector,
  testingPerformanceBenchmarker,
  testingRealityChecker,
  testingTestResultsAnalyzer,
  testingToolEvaluator,
  testingWorkflowOptimizer,
} satisfies Record<string, RolePreset>;
