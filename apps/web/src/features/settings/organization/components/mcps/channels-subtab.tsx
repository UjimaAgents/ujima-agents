"use client";

import { Check, Hash, Plug, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  Channel,
  ChannelMcpAttachment,
  McpAttachmentTier,
} from "@ujima/shared";
import type {
  ChannelMcpAttachInput,
  ChannelMcpAttachmentResponse,
  ChannelMcpAttachmentsResponse,
  McpCatalogServer,
} from "@ujima/api-schema";
import { settingsFetch, settingsFetchVoid } from "@/features/settings/shared/settings-api";
import type { UseMcpCatalog } from "./use-mcp-catalog";

interface Props {
  orgId: string;
  /**
   * Existing org-wide catalog from useMcpCatalog. The channels-subtab
   * reuses it for the server picker + the per-server tools count
   * rather than re-fetching, so a single mcps-tab snapshot drives
   * both the agents and channels surfaces.
   */
  catalog: UseMcpCatalog;
}

/**
 * Per-channel attachment tier toggle. Mirrors the agents-subtab
 * TierToggle (same ARIA radio pattern + non-jargon labels). Inlined
 * rather than extracted because the agents-subtab version uses
 * agent-scoped state and lifting the shape into a shared component
 * would force a generic that obscures more than it shares for a
 * 30-line widget.
 */
function ChannelTierToggle({
  tier,
  disabled,
  onChange,
}: {
  tier: McpAttachmentTier;
  disabled: boolean;
  onChange: (next: McpAttachmentTier) => void;
}) {
  const groupName = useId();
  const options: { value: McpAttachmentTier; label: string }[] = [
    { value: "native", label: "Always on" },
    { value: "dispatch", label: "On demand" },
  ];
  return (
    <fieldset
      aria-label="Attachment tier"
      disabled={disabled}
      className="m-0 inline-flex overflow-hidden rounded-full border border-zinc-200 p-0 text-[11px] dark:border-zinc-800"
    >
      {options.map((opt) => {
        const selected = opt.value === tier;
        return (
          <label
            key={opt.value}
            className={`cursor-pointer px-2 py-0.5 transition focus-within:ring-2 focus-within:ring-zinc-400 focus-within:ring-offset-0 ${
              selected
                ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
            } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
          >
            <input
              type="radio"
              name={groupName}
              value={opt.value}
              checked={selected}
              onChange={() => onChange(opt.value)}
              className="sr-only"
            />
            {opt.label}
          </label>
        );
      })}
    </fieldset>
  );
}

export function ChannelsSubtab({ orgId, catalog }: Props) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string>("");

  const [attachments, setAttachments] = useState<ChannelMcpAttachment[] | null>(
    null,
  );
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAttach, setShowAttach] = useState(false);
  // Implicit loading state — `attachments === null` is "not yet
  // fetched". This avoids the React 19 react-hooks/set-state-in-effect
  // warning that fires when an effect dispatches setLoading(true)
  // synchronously. Same shape as the PR 9 curation panel.
  const attachmentsLoading = attachments === null && attachmentsError === null;
  // De-dupe the per-channel fetch so effect re-runs (caused by
  // unrelated parent state) don't re-fire the network call.
  const lastFetchedChannelId = useRef<string | null>(null);

  // Fetch channels once on mount. Channels rarely churn during a
  // settings session and re-fetching them on every subtab re-render
  // would flash the empty state.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await settingsFetch<Channel[]>(
          `/api/orgs/${encodeURIComponent(orgId)}/channels`,
          { method: "GET" },
          "Failed to load channels.",
        );
        if (cancelled) return;
        setChannels(list);
        if (list.length > 0) setActiveChannelId((current) => current || list[0]!.id);
      } catch (err) {
        if (!cancelled) {
          setChannelsError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setChannelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const loadAttachments = useCallback(
    async (channelId: string) => {
      if (!orgId || !channelId) return;
      try {
        const res = await settingsFetch<ChannelMcpAttachmentsResponse>(
          `/api/settings/channels/${encodeURIComponent(channelId)}/mcps?organizationId=${encodeURIComponent(orgId)}`,
          { method: "GET" },
          "Failed to load channel attachments.",
        );
        setAttachments(res.attachments);
        setAttachmentsError(null);
      } catch (err) {
        setAttachmentsError(err instanceof Error ? err.message : String(err));
      }
    },
    [orgId],
  );

  useEffect(() => {
    if (!activeChannelId) return;
    if (lastFetchedChannelId.current === activeChannelId) return;
    lastFetchedChannelId.current = activeChannelId;
    // Fire-and-forget. We deliberately do NOT reset attachments to
    // null on channel switch — that would be a synchronous setState
    // inside the effect (the React 19 react-hooks/set-state-in-effect
    // rule). The brief flash of the previous channel's data during
    // the fetch is acceptable; the header already changes to show the
    // active channel so the inconsistency is visually scoped.
    void loadAttachments(activeChannelId);
  }, [activeChannelId, loadAttachments]);

  // Attached server ids on the current channel, for the attach
  // picker filter and the per-server "attached" badge. Empty set
  // while the initial fetch is in-flight (attachments === null).
  const attachedServerIds = useMemo(
    () => new Set((attachments ?? []).map((a) => a.mcpServerId)),
    [attachments],
  );

  const allServers = useMemo(
    () =>
      Object.values(catalog.catalogByServer).filter(
        (s): s is McpCatalogServer => s !== undefined,
      ),
    [catalog.catalogByServer],
  );

  const availableServers = useMemo(
    () => allServers.filter((s) => !attachedServerIds.has(s.id)),
    [allServers, attachedServerIds],
  );

  const handleTierChange = useCallback(
    async (mcpServerId: string, nextTier: McpAttachmentTier) => {
      if (!activeChannelId) return;
      setBusy(`tier:${mcpServerId}`);
      setAttachmentsError(null);
      try {
        const res = await settingsFetch<ChannelMcpAttachmentResponse>(
          `/api/settings/channels/${encodeURIComponent(activeChannelId)}/mcps/${encodeURIComponent(mcpServerId)}/tier`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ organizationId: orgId, tier: nextTier }),
          },
          "Unable to update tier.",
        );
        setAttachments((rows) =>
          (rows ?? []).map((a) =>
            a.mcpServerId === mcpServerId ? res.attachment : a,
          ),
        );
      } catch (err) {
        setAttachmentsError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [activeChannelId, orgId],
  );

  const handleDetach = useCallback(
    async (mcpServerId: string) => {
      if (!activeChannelId) return;
      setBusy(`detach:${mcpServerId}`);
      setAttachmentsError(null);
      try {
        await settingsFetchVoid(
          `/api/settings/channels/${encodeURIComponent(activeChannelId)}/mcps/${encodeURIComponent(mcpServerId)}?organizationId=${encodeURIComponent(orgId)}`,
          { method: "DELETE" },
          "Unable to detach MCP server.",
        );
        setAttachments((rows) =>
          (rows ?? []).filter((a) => a.mcpServerId !== mcpServerId),
        );
      } catch (err) {
        setAttachmentsError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [activeChannelId, orgId],
  );

  const handleAttach = useCallback(
    async (mcpServerId: string) => {
      if (!activeChannelId) return;
      setBusy(`attach:${mcpServerId}`);
      setAttachmentsError(null);
      try {
        const body: ChannelMcpAttachInput = {
          organizationId: orgId,
          mcpServerId,
          scope: "worker",
        };
        await settingsFetchVoid(
          `/api/settings/channels/${encodeURIComponent(activeChannelId)}/mcps`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
          "Unable to attach MCP server.",
        );
        await loadAttachments(activeChannelId);
        setShowAttach(false);
      } catch (err) {
        setAttachmentsError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [activeChannelId, orgId, loadAttachments],
  );

  if (channelsLoading) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Loading channels&hellip;
      </p>
    );
  }

  if (channelsError) {
    return (
      <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
        {channelsError}
      </p>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        No channels yet. Create a channel first under Channels &rarr; Add.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
      <aside className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="border-b border-zinc-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Channels
        </div>
        <ul>
          {channels.map((channel) => {
            const active = channel.id === activeChannelId;
            return (
              <li key={channel.id}>
                <button
                  type="button"
                  onClick={() => setActiveChannelId(channel.id)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                    active
                      ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
                      : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }`}
                >
                  <Hash className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="truncate">{channel.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            MCP attachments inherit to every agent in the channel. Per-agent
            attachments override on conflict; dispatch wins on channel-vs-channel
            conflicts.
          </span>
          <button
            type="button"
            onClick={() => setShowAttach((v) => !v)}
            disabled={availableServers.length === 0}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            <Plus className="h-3 w-3" />
            {showAttach ? "Cancel" : "Attach MCP"}
          </button>
        </div>

        {attachmentsError ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {attachmentsError}
          </div>
        ) : null}

        {showAttach ? (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/50">
            {availableServers.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                Every org MCP is already attached to this channel.
              </p>
            ) : (
              <ul className="space-y-1">
                {availableServers.map((server) => (
                  <li
                    key={server.id}
                    className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5 text-[11px] dark:bg-zinc-950"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                        {server.name}
                      </p>
                      <p className="truncate text-zinc-500 dark:text-zinc-400">
                        {server.tools.length} tools
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleAttach(server.id)}
                      disabled={busy === `attach:${server.id}`}
                      className="shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-0.5 font-medium text-zinc-800 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Check className="mr-1 inline-block h-3 w-3" />
                      Attach
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {attachmentsLoading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading&hellip;</p>
        ) : (attachments ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <Plug className="mx-auto mb-2 h-5 w-5 text-zinc-400" />
            No MCPs attached to this channel yet.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {(attachments ?? []).map((attachment) => {
              const server = catalog.catalogByServer[attachment.mcpServerId];
              const name = server?.name ?? attachment.mcpServerId;
              const toolCount = server?.tools.length ?? 0;
              return (
                <li
                  key={attachment.id}
                  className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-[11px] dark:border-zinc-800 dark:bg-[#0f0f10]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                      {name}
                    </p>
                    <p className="truncate text-zinc-500 dark:text-zinc-400">
                      {toolCount} tools &middot; scope: {attachment.scope}
                    </p>
                  </div>
                  <ChannelTierToggle
                    tier={attachment.tier}
                    disabled={busy === `tier:${attachment.mcpServerId}`}
                    onChange={(next) =>
                      void handleTierChange(attachment.mcpServerId, next)
                    }
                  />
                  <button
                    type="button"
                    onClick={() => void handleDetach(attachment.mcpServerId)}
                    disabled={busy === `detach:${attachment.mcpServerId}`}
                    aria-label="Detach"
                    className="shrink-0 rounded-md p-1 text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
