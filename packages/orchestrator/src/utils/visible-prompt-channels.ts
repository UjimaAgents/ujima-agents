import type { Channel } from '@ujima/shared';

interface ChannelArchiveSource {
  listAllChannels(organizationId: string): Channel[];
}

/**
 * Resolves config-time channel handles to their canonical runtime
 * rows before they land in the system prompt.
 *
 * Why this exists:
 *
 *   - `team.channels` is built by `normalizeChannels`, which falls
 *     back to `id = name` when config gives a name handle (e.g.
 *     `channels: ['general']`). That synthetic id may not match the
 *     real DB id of the live runtime channel — and the agent's
 *     `channel.read` call goes through `repo.getChannel(orgId, id)`,
 *     which is a strict id lookup. Without resolution, a name handle
 *     in the prompt fails silently at tool-call time.
 *   - Archived runtime channels left in the prompt cause the agent
 *     to loop forever calling `channel.read` on a dead channel.
 *
 * Resolution rules (first match wins):
 *
 *   1. Handle.id matches a live runtime channel.id → emit that
 *      live channel (real id, current topic, current memberIds).
 *   2. Handle.name matches exactly one live channel → emit that
 *      live channel (the name handle is unambiguous). This runs
 *      before the archived-id reject so a synthetic `id = name`
 *      handle still binds to its live replacement when the old
 *      archived row also used `id = name`.
 *   3. Handle.name matches multiple live channels → drop. Genuinely
 *      ambiguous; binding to the wrong one is worse than omitting.
 *   4. Handle.id matches an archived id → drop (dead reference,
 *      and no live name match exists per rules 2-3).
 *   5. Handle.name (or handle.id) matches an archived-only name
 *      (archived rows with that name, no live row) → drop.
 *   6. No runtime presence at all → pass the handle through. This
 *      covers the bootstrap case where config-sync hasn't created
 *      the DB row yet; the next sync will fill it in.
 */
export function resolveVisiblePromptChannels(
  handles: readonly Channel[],
  repo: ChannelArchiveSource,
  organizationId: string,
): Channel[] {
  const liveById = new Map<string, Channel>();
  const liveByName = new Map<string, Channel[]>();
  const archivedIds = new Set<string>();
  const archivedNames = new Set<string>();

  for (const channel of repo.listAllChannels(organizationId)) {
    if (channel.archivedAt) {
      archivedIds.add(channel.id);
      if (channel.name) archivedNames.add(channel.name);
      continue;
    }
    liveById.set(channel.id, channel);
    if (channel.name) {
      const list = liveByName.get(channel.name) ?? [];
      list.push(channel);
      liveByName.set(channel.name, list);
    }
  }

  const out: Channel[] = [];
  const seen = new Set<string>();
  const push = (channel: Channel) => {
    if (seen.has(channel.id)) return;
    seen.add(channel.id);
    out.push(channel);
  };

  for (const handle of handles) {
    const byId = liveById.get(handle.id);
    if (byId) {
      push(byId);
      continue;
    }

    // Resolve unambiguous live name match BEFORE rejecting on archived
    // id. The archived row may share its id with the handle's synthetic
    // id (config-sync wrote `id = name` previously, then the row was
    // archived, then a replacement was created with a real DB id and
    // the same name). Rejecting on archived id first would hide the
    // live replacement that the handle is meant to bind to.
    const namedMatches = liveByName.get(handle.name);
    if (namedMatches && namedMatches.length > 1) continue;
    const soleNameMatch = namedMatches?.[0];
    if (soleNameMatch) {
      push(soleNameMatch);
      continue;
    }

    if (archivedIds.has(handle.id)) continue;
    if (archivedNames.has(handle.id) || archivedNames.has(handle.name)) continue;

    push(handle);
  }

  return out;
}
