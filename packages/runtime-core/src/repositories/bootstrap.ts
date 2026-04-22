import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import type {
  ApprovalRequest,
  Channel,
  Member,
  Organization,
  RunState,
} from '@ujima/shared';
import { getLatestOrganization, listProviderCredentials } from './organization.js';
import { listMembers } from './members.js';
import { listChannels } from './channels.js';
import { listPendingApprovals } from './approvals.js';
import { listRuns } from './runs.js';

export interface BootstrapSnapshot {
  organization: Organization | null;
  members: Member[];
  channels: Channel[];
  pendingApprovals: ApprovalRequest[];
  activeRuns: RunState[];
  providerCredentials: Record<string, boolean>;
}

export function getBootstrapSnapshot(db: DbHandle): BootstrapSnapshot {
  const organization = getLatestOrganization(db);
  if (!organization) {
    return {
      organization: null,
      members: [],
      channels: [],
      pendingApprovals: [],
      activeRuns: [],
      providerCredentials: {},
    };
  }

  const runs = listRuns(db, organization.id).data;
  const activeRuns = runs.filter(
    (run) =>
      run.status === 'queued' ||
      run.status === 'running' ||
      run.status === 'waiting_for_approval',
  );

  return {
    organization,
    members: listMembers(db, organization.id),
    channels: listChannels(db, organization.id).data,
    pendingApprovals: listPendingApprovals(db, organization.id),
    activeRuns,
    providerCredentials: listProviderCredentials(db, organization.id),
  };
}
