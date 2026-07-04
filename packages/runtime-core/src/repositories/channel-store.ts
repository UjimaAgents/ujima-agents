import type {
  Channel,
  ChannelKind,
  ChannelMemberMode,
  ChannelMemberSettings,
} from '@ujima/shared';

export interface PaginatedChannels {
  data: Channel[];
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * Narrow port for channel operations.
 */
export interface ChannelStore {
  saveChannel(channel: Channel): Channel;
  getChannel(organizationId: string, channelId: string): Channel | null;
  listAllChannels(organizationId: string): Channel[];
  listChannels(
    organizationId: string,
    cursor?: string,
    limit?: number,
    excludeKinds?: readonly ChannelKind[],
  ): PaginatedChannels;
  setChannelMembers(
    organizationId: string,
    channelId: string,
    memberIds: string[],
  ): void;
  deleteChannel(organizationId: string, channelId: string): void;
  setChannelMemberMode(
    organizationId: string,
    channelId: string,
    memberId: string,
    mode: ChannelMemberMode,
  ): void;
  getChannelMemberMode(
    organizationId: string,
    channelId: string,
    memberId: string,
  ): ChannelMemberMode | null;
  listChannelMemberModes(
    organizationId: string,
    memberId: string,
  ): ChannelMemberSettings[];
  listChannelMemberModesForChannel(
    organizationId: string,
    channelId: string,
  ): ChannelMemberSettings[];
  deleteChannelMemberMode(
    organizationId: string,
    channelId: string,
    memberId: string,
  ): void;
}
