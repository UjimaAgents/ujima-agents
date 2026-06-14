import { safeFallbackModelForProvider } from '@ujima/shared';
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
  return ({ organizationId, memberId, role, forceSafeFallback, reasoningEffort }) => {
    const team = requireTeam(teamStore, organizationId);
    const member = repo.getMember(organizationId, memberId);
    if (!member) {
      throw new Error(`Member not found: ${memberId}`);
    }
    // `forceSafeFallback` is set by spirit-agent-run.ts after the
    // live provider returns 404 for the originally-resolved model
    // id. Swap to a resolver that ignores per-member / per-role
    // overrides AND the team-configured provider default — instead
    // returning the conservative `safeFallbackModelForProvider`
    // baseline for the provider's kind. That id is the one we've
    // verified the live API will actually serve, so the retry
    // succeeds.
    const resolveModelId = forceSafeFallback
      ? (_r: { model?: string }, p: { kind?: string; defaultModel?: string }) =>
          safeFallbackModelForProvider(p.kind ?? '') ?? p.defaultModel
      : defaultResolveModelId;
    return resolveSpiritModel({
      organizationId,
      memberId,
      role,
      member,
      team,
      getProviderCredential: (orgId, key) => repo.getProviderCredential(orgId, key),
      resolveProviderName: defaultResolveProviderName,
      resolveModelId,
      reasoningEffort,
    });
  };
}
