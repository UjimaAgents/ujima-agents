import type { AuthState } from './auth.js';
import type { BootstrapSnapshot, ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import type { TeamSummary } from './team.js';
import type { AuthService } from './auth.js';
import {
  listProviderStatuses,
  summarizeTeam,
} from './team.js';

export interface BootstrapResponse {
  serviceReady: true;
  onboardingStatus: 'pending' | 'ready';
  organization: { id: string; name: string } | null;
  team: TeamSummary | null;
  providers: { name: string; hasKey: boolean }[];
  members: BootstrapSnapshot['members'];
  channels: BootstrapSnapshot['channels'];
  pendingApprovals: BootstrapSnapshot['pendingApprovals'];
  activeRuns: BootstrapSnapshot['activeRuns'];
  auth: AuthState;
}

export class BootstrapService {
  constructor(
    private readonly repo: ApiRepository,
    private readonly teamStore: TeamStore,
    private readonly auth: AuthService,
  ) {}

  getBootstrap(input: { sessionToken?: string | null } = {}): BootstrapResponse {
    const snapshot = this.repo.getBootstrapSnapshot();
    const team = this.teamStore.getTeam();

    return {
      serviceReady: true,
      onboardingStatus: snapshot.organization ? 'ready' : 'pending',
      organization: snapshot.organization
        ? { id: snapshot.organization.id, name: snapshot.organization.name }
        : null,
      team: team ? summarizeTeam(team) : null,
      providers: team ? listProviderStatuses(team, snapshot.providerCredentials) : [],
      members: snapshot.members,
      channels: snapshot.channels,
      pendingApprovals: snapshot.pendingApprovals,
      activeRuns: snapshot.activeRuns,
      auth: this.auth.getAuthState(input.sessionToken),
    };
  }
}
