import type { Channel } from '@ujima/shared';

interface ChannelArchiveSource {
  listAllChannels(organizationId: string): Channel[];
}

/**
 * Returns the system-prompt channel list with runtime-archived
 * channels filtered out.
 *
 * `team.channels` comes from static config and never carries
 * `archivedAt`, so without this filter an archived channel still
 * shows up in the system prompt — the agent then calls
 * `channel.read` on it, the conversation service throws
 * "Channel not found", and the loop retries forever (each retry
 * costs a full LLM round-trip plus a cache miss).
 *
 * Channel handles can be either id or name in config (both default
 * to `name` via `normalizeChannels`), so we drop matches against
 * either field.
 */
export function filterVisiblePromptChannels(
  channels: readonly Channel[],
  repo: ChannelArchiveSource,
  organizationId: string,
): Channel[] {
  const archivedHandles = new Set<string>();
  for (const channel of repo.listAllChannels(organizationId)) {
    if (!channel.archivedAt) continue;
    archivedHandles.add(channel.id);
    if (channel.name) archivedHandles.add(channel.name);
  }
  if (archivedHandles.size === 0) return [...channels];
  return channels.filter(
    (channel) => !archivedHandles.has(channel.id) && !archivedHandles.has(channel.name),
  );
}
