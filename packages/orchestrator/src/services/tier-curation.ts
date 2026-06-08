import type { ApiRepository } from './repository-reader.js';

// Bidirectional tier curation (mcp_connector_dispatch_plan.md §9.4).
//
// The audit-driven candidate analysis lands in PR 9; PR 8 ships only
// the surface so the suggestions table + UI zero-state can be wired
// up ahead of the analytics rollout. The §9.4 rules PR 9 will
// implement:
//
//   demote candidates: tier='native' + zero invocations in the last
//     N days. Native attachments cost system-prompt budget — if a
//     tool is never called, the cost is pure overhead.
//
//   promote candidates: tier='dispatch' + invocation volume >= V
//     and error-rate <= E in the last N days. A dispatch-tier tool
//     called often + reliably has earned the typed-schema slot.
//
// Both signals derive from the §12 connector_invocation_* audit rows
// shipped in PR 8 above. The analyzer reads, scores, and writes
// suggestions. It does NOT auto-apply — operators see the panel and
// flip tiers themselves via PR 6's settings UI.

export interface TierCurationDeps {
  repo: Pick<ApiRepository, 'saveTierCurationSuggestion' | 'listTierCurationSuggestions'>;
}

export interface TierCurationService {
  /**
   * Run one pass of the audit-driven analysis for the given org.
   *
   * PR 8: no-op stub. The signature is fixed now so PR 9 can fill in
   * the body without rippling through callers (the eventual cron
   * worker, an admin "Refresh suggestions" button, etc.).
   */
  analyzeOrganization(input: {
    organizationId: string;
    /** Lookback window for invocation + idle signals. PR 9 default: 14 days. */
    windowDays?: number;
  }): Promise<{ suggestionsWritten: number }>;
}

export function createTierCurationService(
  deps: TierCurationDeps,
): TierCurationService {
  return {
    async analyzeOrganization(input) {
      // Intentional no-op for PR 8. The unused `deps` and `input`
      // arguments are part of the contract PR 9 fills.
      void deps;
      void input;
      return { suggestionsWritten: 0 };
    },
  };
}
