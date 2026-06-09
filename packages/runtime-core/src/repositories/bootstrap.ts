import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import type {
  ApprovalRequest,
  Channel,
  Member,
  Organization,
  RunState,
} from '@ujima/shared';
import { getLatestOrganization, getOrganization, listProviderCredentials } from './organization.js';
import { listMembers } from './members.js';
import { listChannels, setChannelMembers } from './channels.js';
import { resolveChannelMemberIds } from '@ujima/shared';
import { listPendingApprovals } from './approvals.js';
import { listActiveRuns } from './runs.js';

export interface BootstrapSnapshot {
  organization: Organization | null;
  members: Member[];
  channels: Channel[];
  pendingApprovals: ApprovalRequest[];
  activeRuns: RunState[];
  providerCredentials: Record<string, boolean>;
}

export function getBootstrapSnapshot(db: DbHandle, organizationId?: string): BootstrapSnapshot {
  const organization = organizationId ? getOrganization(db, organizationId) : getLatestOrganization(db);
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

  const activeRuns = listActiveRuns(db, organization.id);
  const activeRunIds = new Set(activeRuns.map((run) => run.id));

  const allChannels: Channel[] = [];
  let channelsCursor: string | undefined = undefined;
  do {
    const page = listChannels(db, organization.id, channelsCursor, 500, ['self', 'dm']);
    allChannels.push(...page.data);
    channelsCursor = page.nextCursor;
  } while (channelsCursor);

  const members = listMembers(db, organization.id).filter((member) => !member.retiredAt);
  const activeMemberIds = new Set(members.map((member) => member.id));
  const channels = allChannels.map((channel) => {
    const memberIds = resolveChannelMemberIds(channel.memberIds, activeMemberIds);
    if (
      memberIds.length === channel.memberIds.length &&
      memberIds.every((memberId, index) => memberId === channel.memberIds[index])
    ) {
      return channel;
    }
    setChannelMembers(db, organization.id, channel.id, memberIds);
    return { ...channel, memberIds };
  });

  return {
    organization,
    members,
    // Bootstrap snapshot is consumed by clients that don't have a member
    // identity yet (it's the very first response on connect). Hide private
    // channel kinds — `self` (agent scratchpads) and `dm` (private 2-member
    // conversations) — at the SQL level so they never enter the snapshot.
    // Member-scoped DM access goes through `listVisibleChannels` instead.
    channels,
    pendingApprovals: listPendingApprovals(db, organization.id).filter(
      (approval) => !!approval.runId && activeRunIds.has(approval.runId),
    ),
    activeRuns,
    providerCredentials: listProviderCredentials(db, organization.id),
  };
}
