import { summarizeTeam } from "../config.ts";
import type { ApiServiceContext } from "./context.ts";
import { listProviderStatuses } from "./team.ts";

export class BootstrapService {
  constructor(private readonly context: ApiServiceContext) {}

  getBootstrap() {
    const snapshot = this.context.repo.getBootstrapSnapshot();
    const team = this.context.team ? summarizeTeam(this.context.team) : null;

    return {
      serviceReady: true,
      onboardingStatus: snapshot.organization ? "ready" : "pending",
      organization: snapshot.organization
        ? {
            id: snapshot.organization.id,
            name: snapshot.organization.name,
          }
        : null,
      team,
      providers: this.context.team
        ? listProviderStatuses(this.context.team, snapshot.providerCredentials)
        : [],
      members: snapshot.members,
      channels: snapshot.channels,
      pendingApprovals: snapshot.pendingApprovals,
      activeRuns: snapshot.activeRuns,
    };
  }
}

