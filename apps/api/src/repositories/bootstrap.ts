import type { Database } from "bun:sqlite";
import { getLatestOrganization, listProviderCredentials } from "./organization.ts";
import { listMembers } from "./members.ts";
import { listChannels } from "./channels.ts";
import { listPendingApprovals } from "./approvals.ts";
import { listRuns } from "./runs.ts";

export interface BootstrapSnapshot {
  organization: ReturnType<typeof getLatestOrganization>;
  members: ReturnType<typeof listMembers>;
  channels: ReturnType<typeof listChannels>;
  pendingApprovals: ReturnType<typeof listPendingApprovals>;
  activeRuns: ReturnType<typeof listRuns>;
  providerCredentials: Record<string, boolean>;
}

export function getBootstrapSnapshot(db: Database): BootstrapSnapshot {
  const organization = getLatestOrganization(db);
  if (!organization) {
    return {
      organization: null,
      members: [],
      channels: [],
      pendingApprovals: [],
      activeRuns: [],
      providerCredentials: {} as Record<string, boolean>,
    };
  }

  return {
    organization,
    members: listMembers(db, organization.id),
    channels: listChannels(db, organization.id),
    pendingApprovals: listPendingApprovals(db, organization.id),
    activeRuns: listRuns(db, organization.id).filter((run) =>
      run.status === "queued" || run.status === "running" || run.status === "waiting_for_approval",
    ),
    providerCredentials: listProviderCredentials(db, organization.id),
  };
}
