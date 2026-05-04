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

  const allRuns: RunState[] = [];
  let runsCursor: string | undefined = undefined;
  do {
    const page = listRuns(db, organization.id, runsCursor, 500);
    allRuns.push(...page.data);
    runsCursor = page.nextCursor;
  } while (runsCursor);

  const activeRuns = allRuns.filter(
    (run) =>
      run.status === 'queued' ||
      run.status === 'running' ||
      run.status === 'waiting_for_approval',
  );

  const allChannels: Channel[] = [];
  let channelsCursor: string | undefined = undefined;
  do {
    const page = listChannels(db, organization.id, channelsCursor, 500, ['self', 'dm']);
    allChannels.push(...page.data);
    channelsCursor = page.nextCursor;
  } while (channelsCursor);

  return {
    organization,
    members: listMembers(db, organization.id),
    // Bootstrap snapshot is consumed by clients that don't have a member
    // identity yet (it's the very first response on connect). Hide private
    // channel kinds — `self` (agent scratchpads) and `dm` (private 2-member
    // conversations) — at the SQL level so they never enter the snapshot.
    // Member-scoped DM access goes through `listVisibleChannels` instead.
    channels: allChannels,
    pendingApprovals: listPendingApprovals(db, organization.id),
    activeRuns,
    providerCredentials: listProviderCredentials(db, organization.id),
  };
}
