import type { AuthState } from './auth.js';
import type { BootstrapSnapshot, ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import type { TeamSummary } from './team.js';
import type { AuthService } from './auth.js';
import { ConfigSyncService } from './config-sync.js';
import { getDirectMessageThreadId } from '@ujima/shared';
import {
  listProviderStatuses,
  summarizeTeam,
} from './team.js';

export interface BootstrapResponse {
  serviceReady: true;
  onboardingStatus: 'pending' | 'ready';
  organization: { id: string; name: string } | null;
  organizations: { id: string; name: string }[];
  team: TeamSummary | null;
  providers: { name: string; hasKey: boolean }[];
  members: BootstrapSnapshot['members'];
  channels: BootstrapSnapshot['channels'];
  pendingApprovals: BootstrapSnapshot['pendingApprovals'];
  activeRuns: BootstrapSnapshot['activeRuns'];
  conversationUnreadCounts: Record<string, number>;
  auth: AuthState;
}

export class BootstrapService {
  constructor(
    private readonly repo: ApiRepository,
    private readonly teamStore: TeamStore,
    private readonly auth: AuthService,
  ) {}

  getBootstrap(input: { sessionToken?: string | null } = {}): BootstrapResponse {
    const authState = this.auth.getAuthState(input.sessionToken);
    const organizationId = authState.authenticated && authState.user
      ? authState.user.organizationId
      : this.repo.getLatestOrganization()?.id;

    if (organizationId) {
      new ConfigSyncService(this.repo, this.teamStore).loadFromStoredConfig(organizationId);
    }

    const snapshot = this.repo.getBootstrapSnapshot(organizationId);
    const team = this.teamStore.getTeam(organizationId);
    const member = snapshot.organization ? authState.member : undefined;

    const accessibleOrgs = authState.authenticated
      ? this.auth.listAccessibleOrganizations(input.sessionToken)
      : [];

    return {
      serviceReady: true,
      onboardingStatus: snapshot.organization ? 'ready' : 'pending',
      organization: snapshot.organization
        ? { id: snapshot.organization.id, name: snapshot.organization.name }
        : null,
      organizations: accessibleOrgs,
      team: team ? summarizeTeam(team) : null,
      providers: team ? listProviderStatuses(team, snapshot.providerCredentials) : [],
      members: snapshot.members,
      channels: snapshot.channels,
      pendingApprovals: snapshot.pendingApprovals,
      activeRuns: snapshot.activeRuns,
      conversationUnreadCounts: member
        ? this.buildConversationUnreadCounts(snapshot, member.id)
        : {},
      auth: authState,
    };
  }

  private buildConversationUnreadCounts(snapshot: BootstrapSnapshot, memberId: string): Record<string, number> {
    if (!snapshot.organization) return {};
    const organizationId = snapshot.organization.id;
    const counts: Record<string, number> = {};

    for (const channel of snapshot.channels) {
      if (channel.kind === 'self' || channel.kind === 'dm') continue;
      const read = this.repo.getConversationRead(organizationId, memberId, channel.id);
      const unread = this.repo.countMessagesSince(organizationId, channel.id, {
        since: read?.lastReadAt,
        excludeSenderId: memberId,
      });
      if (unread > 0) {
        counts[channel.id] = unread;
      }
    }

    for (const peer of snapshot.members) {
      if (peer.kind !== 'agent' || peer.id === memberId) continue;
      const threadId = getDirectMessageThreadId(memberId, peer.id);
      const read = this.repo.getConversationRead(organizationId, memberId, threadId);
      const unread = this.repo.countMessagesSince(organizationId, threadId, {
        since: read?.lastReadAt,
        excludeSenderId: memberId,
      });
      if (unread > 0) {
        counts[peer.id] = unread;
      }
    }
    return counts;
  }
}
