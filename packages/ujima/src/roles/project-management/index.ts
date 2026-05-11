import type { RolePreset } from '../../schemas.js';
import { projectManagementExperimentTracker } from './project-management-experiment-tracker.js';
import { projectManagementJiraWorkflowSteward } from './project-management-jira-workflow-steward.js';
import { projectManagementProjectShepherd } from './project-management-project-shepherd.js';
import { projectManagementStudioOperations } from './project-management-studio-operations.js';
import { projectManagementStudioProducer } from './project-management-studio-producer.js';
import { projectManagerSenior } from './project-manager-senior.js';

export { projectManagementExperimentTracker } from './project-management-experiment-tracker.js';
export { projectManagementJiraWorkflowSteward } from './project-management-jira-workflow-steward.js';
export { projectManagementProjectShepherd } from './project-management-project-shepherd.js';
export { projectManagementStudioOperations } from './project-management-studio-operations.js';
export { projectManagementStudioProducer } from './project-management-studio-producer.js';
export { projectManagerSenior } from './project-manager-senior.js';

export const ProjectManagement_ROLE_PRESETS = {
  projectManagementExperimentTracker,
  projectManagementJiraWorkflowSteward,
  projectManagementProjectShepherd,
  projectManagementStudioOperations,
  projectManagementStudioProducer,
  projectManagerSenior,
} satisfies Record<string, RolePreset>;
