"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import type {
  TierCurationSuggestionsResponse,
  RefreshTierCurationResponse,
} from "@ujima/api-schema";
import type { TierCurationSuggestion } from "@ujima/shared";
import { settingsFetch } from "@/features/settings/shared/settings-api";

/**
 * PR 9 — tier curation suggestions panel
 * (mcp_connector_dispatch_plan.md §9.4).
 *
 * Reads the org's pending demote/promote candidates from the analyzer
 * and lets operators apply them through the existing PR 6 tier-flip
 * endpoint (via the `onApply` callback). Filtered to the active agent
 * so the panel doesn't dump 100+ org-wide rows on every render — the
 * agents-subtab already has per-agent context, this just inherits it.
 *
 * The §17.5 orthogonality invariant lives at the apply path, not here:
 * clicking "Apply" calls the same PATCH endpoint the manual toggle
 * already uses, so the audit trail (connector_tier_changed event)
 * looks identical whether the operator clicked the toggle or applied
 * a suggestion.
 */
export function CurationSuggestionsPanel({
  orgId,
  agentId,
  serverNameById,
  onApply,
}: {
  orgId: string;
  agentId: string;
  /**
   * Map of server id → human-friendly name, sourced from the catalog
   * the parent already loaded. The analyzer writes only server ids;
   * showing them raw is unfriendly, but we don't want this panel to
   * re-fetch the catalog when the parent already has it.
   */
  serverNameById: Record<string, string>;
  /**
   * Applies a suggestion by flipping the attachment tier. Routes
   * through the parent's existing useMcpCatalog.updateAttachmentTier
   * so the audit trail + cache refresh are shared.
   */
  onApply: (suggestion: TierCurationSuggestion) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TierCurationSuggestionsResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Loading state is implicit: `data === null` before the first fetch
  // returns. Avoids the setState-in-effect cascading-render warning
  // Next 16 flags on a more conventional `setLoading(true)` pattern.
  const loading = data === null && error === null;
  const fetchedFor = useRef<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await settingsFetch<TierCurationSuggestionsResponse>(
        `/api/settings/mcps/tier-curation-suggestions?organizationId=${encodeURIComponent(orgId)}`,
        { method: "GET" },
        "Unable to load curation suggestions.",
      );
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [orgId]);

  useEffect(() => {
    if (!expanded) return;
    // De-dupe per (expanded × orgId) so re-renders don't re-fire the
    // fetch. Manual refresh is the explicit re-load surface.
    if (fetchedFor.current === orgId) return;
    fetchedFor.current = orgId;
    void fetchData();
  }, [expanded, orgId, fetchData]);

  // Filter to this agent's suggestions. The org-wide list comes back
  // from the daemon; we render the per-agent slice but keep the
  // headline counters from the unfiltered summary so operators see
  // the org-wide total at a glance ("3 of 12 pending across the org").
  const allSuggestions = data?.suggestions ?? [];
  const agentSuggestions = allSuggestions.filter((s) => s.memberId === agentId);

  const handleApply = useCallback(
    async (suggestion: TierCurationSuggestion) => {
      setBusyId(suggestion.id);
      try {
        await onApply(suggestion);
        // Optimistic: drop the row from local state. The next manual
        // refresh / cron pass will reconcile.
        setData((current) =>
          current
            ? {
                ...current,
                suggestions: current.suggestions.filter((s) => s.id !== suggestion.id),
                summary: {
                  ...current.summary,
                  pending: Math.max(0, current.summary.pending - 1),
                  demoteCount:
                    suggestion.direction === "demote"
                      ? Math.max(0, current.summary.demoteCount - 1)
                      : current.summary.demoteCount,
                  promoteCount:
                    suggestion.direction === "promote"
                      ? Math.max(0, current.summary.promoteCount - 1)
                      : current.summary.promoteCount,
                },
              }
            : current,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [onApply],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      // Trigger the analyzer, then re-list. Two round-trips because
      // the analyzer's return shape is counts, not the suggestion
      // rows themselves.
      await settingsFetch<RefreshTierCurationResponse>(
        `/api/settings/mcps/tier-curation-suggestions/refresh`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId: orgId }),
        },
        "Unable to refresh curation suggestions.",
      );
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [orgId, fetchData]);

  // Collapsed-by-default — the panel is opt-in. Operators who want to
  // review suggestions before flipping anything click the header.
  return (
    <div className="rounded-md border border-zinc-200 bg-white text-[11px] dark:border-zinc-800 dark:bg-[#0f0f10]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
        )}
        <span className="font-medium text-zinc-900 dark:text-zinc-100">
          Tier suggestions
        </span>
        {data?.summary ? (
          <span className="text-zinc-500 dark:text-zinc-400">
            {agentSuggestions.length} for this agent · {data.summary.pending} org-wide
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div className="space-y-2 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            <span>Analyzer findings · last {30} runs</span>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-0.5 text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Running…" : "Refresh"}
            </button>
          </div>

          {error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              {error}
            </p>
          ) : null}

          {loading && !data ? (
            <p className="text-zinc-500 dark:text-zinc-400">Loading…</p>
          ) : agentSuggestions.length === 0 ? (
            <p className="text-zinc-500 dark:text-zinc-400">
              No suggestions for this agent. The analyzer flags native
              attachments idle for 30 runs (demote candidates) and
              dispatch attachments with high volume × high error rate
              (promote candidates).
            </p>
          ) : (
            <ul className="space-y-1.5">
              {agentSuggestions.map((s) => (
                <SuggestionRow
                  key={s.id}
                  suggestion={s}
                  serverName={serverNameById[s.mcpServerId] ?? s.mcpServerId}
                  busy={busyId === s.id}
                  onApply={() => void handleApply(s)}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SuggestionRow({
  suggestion,
  serverName,
  busy,
  onApply,
}: {
  suggestion: TierCurationSuggestion;
  serverName: string;
  busy: boolean;
  onApply: () => void;
}) {
  const tone =
    suggestion.direction === "demote"
      ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
      : "border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/40";
  const label = suggestion.direction === "demote" ? "Demote to dispatch" : "Promote to native";
  return (
    <li className={`flex items-start gap-2 rounded-md border px-2 py-1.5 ${tone}`}>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">
          {serverName} · {label}
        </p>
        <p className="text-zinc-600 dark:text-zinc-400">{suggestion.rationale}</p>
      </div>
      <button
        type="button"
        onClick={onApply}
        disabled={busy}
        className="shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-0.5 font-medium text-zinc-800 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        {busy ? "Applying…" : "Apply"}
      </button>
    </li>
  );
}
