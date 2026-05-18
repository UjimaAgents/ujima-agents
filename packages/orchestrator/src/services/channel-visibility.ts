import type { Channel } from '@ujima/shared';

export function visiblePublicChannels(channels: Channel[]): Channel[] {
  return channels.filter((channel) => channel.kind !== 'self' && channel.kind !== 'dm');
}
