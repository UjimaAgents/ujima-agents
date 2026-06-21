import type { ApiRepository } from '../services/repository-reader.js';
import type { ModelResolver } from '../services/spirit-types.js';
import type { TeamStore } from '../services/team-store.js';
import { requireTeam } from './require-team.js';
import {
  defaultResolveModelId,
  defaultResolveProviderName,
  resolveSpiritModel,
} from './to-model-messages.js';

export function createSpiritModelResolver(
  teamStore: TeamStore,
  repo: ApiRepository,
): ModelResolver {
  return ({ organizationId, memberId, role, reasoningEffort }) => {
    const team = requireTeam(teamStore, organizationId);
    const member = repo.getMember(organizationId, memberId);
    if (!member) {
      throw new Error(`Member not found: ${memberId}`);
    }
    return resolveSpiritModel({
      organizationId,
      memberId,
      role,
      member,
      team,
      getProviderCredential: (orgId, key) => repo.getProviderCredential(orgId, key),
      resolveProviderName: defaultResolveProviderName,
      resolveModelId: defaultResolveModelId,
      reasoningEffort,
    });
  };
}
