import { McpRegistryService } from './mcp-registry.js';
import { SettingsService } from './settings.js';
import { TaskSessionService } from './task-session.js';
import { createTierCurationService, type TierCurationService } from './tier-curation.js';
import { GovernanceService } from './governance-service.js';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import type { ApprovalService } from './approval.js';
import type { ConversationService } from './conversation.js';
import type { SpiritService } from './spirit.js';

export interface AdminDomainInput {
  repo: ApiRepository;
  teamStore: TeamStore;
  approvals: ApprovalService;
  conversations: ConversationService;
  spirits: SpiritService;
}

export interface AdminDomainOutput {
  settings: SettingsService;
  taskSessions: TaskSessionService;
  mcpRegistry: McpRegistryService;
  tierCuration: TierCurationService;
  governance: GovernanceService;
}

export function createAdminDomain(input: AdminDomainInput): AdminDomainOutput {
  const settings = new SettingsService(input.repo, input.teamStore, input.approvals);
  const taskSessions = new TaskSessionService(
    input.repo,
    input.conversations,
    input.spirits,
  );
  const mcpRegistry = new McpRegistryService(input.repo);
  const tierCuration = createTierCurationService({ repo: input.repo });
  const governance = new GovernanceService(input.repo);

  return { settings, taskSessions, mcpRegistry, tierCuration, governance };
}
