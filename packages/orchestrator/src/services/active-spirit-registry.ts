import type { Spirit } from '@ujima/shared';

// ----------------------------------------------------------------------
// ActiveSpiritRegistry — Phase 2.C.1
//
// In-memory map of `member_id → Set<spirit_id>` for spirits whose role
// is `worker` and whose status is alive (queued|running|waiting_for_approval).
// The supervisor dispatch path consults this registry on every
// `member.alerted` event to decide whether to spawn a supervisor turn or
// fall through to the regular wake path.
//
// Why a registry on top of the DB row?
//   * The supervisor gate fires on the hot path of every mention. A
//     repository scan is fine when the cluster is small, but the registry
//     gives us O(1) membership at no marginal cost.
//   * It centralises the "this member has live work" view so we can add
//     bookkeeping later (per-member backpressure, debounce windows
//     keyed on activity, etc.) without scattering it across services.
//
// The DB rows are still authoritative — this is a denormalised cache.
// On daemon boot the registry is empty; SpiritService.bootstrap() walks
// `listActiveSpiritsForMember` per organisation and registers anything
// that survived a restart, so a crash + restart doesn't lose the gate.
// ----------------------------------------------------------------------

export interface ActiveSpiritEntry {
  spiritId: string;
  organizationId: string;
  taskSessionId: string;
  memberId: string;
}

function memberKey(organizationId: string, memberId: string): string {
  return `${organizationId}:${memberId}`;
}

export class ActiveSpiritRegistry {
  private readonly entries = new Map<string, Map<string, ActiveSpiritEntry>>();

  /**
   * Mark a spirit as active. Only worker-role spirits should land here —
   * supervisors are short-lived per-turn objects and don't wake their
   * own kind. Re-registering an existing spirit id is idempotent.
   */
  register(spirit: Spirit): void {
    if (spirit.role !== 'worker') return;
    if (!isAliveStatus(spirit.status)) return;
    const key = memberKey(spirit.organizationId, spirit.memberId);
    const bucket = this.entries.get(key) ?? new Map<string, ActiveSpiritEntry>();
    bucket.set(spirit.id, {
      spiritId: spirit.id,
      organizationId: spirit.organizationId,
      taskSessionId: spirit.taskSessionId,
      memberId: spirit.memberId,
    });
    this.entries.set(key, bucket);
  }

  /** Remove a spirit by id; safe to call when the spirit isn't tracked. */
  unregister(organizationId: string, memberId: string, spiritId: string): void {
    const key = memberKey(organizationId, memberId);
    const bucket = this.entries.get(key);
    if (!bucket) return;
    bucket.delete(spiritId);
    if (bucket.size === 0) {
      this.entries.delete(key);
    }
  }

  /**
   * Lookup all active worker spirits for a given member. Empty list →
   * the supervisor gate falls through to the regular wake path.
   */
  getActiveForMember(organizationId: string, memberId: string): ActiveSpiritEntry[] {
    const bucket = this.entries.get(memberKey(organizationId, memberId));
    return bucket ? [...bucket.values()] : [];
  }

  /** Convenience for the common "is anything alive for this member?" check. */
  hasActiveForMember(organizationId: string, memberId: string): boolean {
    const bucket = this.entries.get(memberKey(organizationId, memberId));
    return bucket !== undefined && bucket.size > 0;
  }

  /**
   * Test/debug helper. Returns the total tracked spirit count across
   * every member. Not part of the supervisor dispatch path.
   */
  size(): number {
    let n = 0;
    for (const bucket of this.entries.values()) n += bucket.size;
    return n;
  }
}

export function isAliveStatus(status: Spirit['status']): boolean {
  return status === 'queued' || status === 'running' || status === 'waiting_for_approval';
}
