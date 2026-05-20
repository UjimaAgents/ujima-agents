"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock, Target } from "lucide-react";

interface ChannelGoalsTodo {
  id: string;
  memberId: string;
  title: string;
  status: string;
  channelId?: string;
  deliverableSummary?: string;
  dueAt?: string;
  lastProgressAt?: string;
  sourceMessageId?: string;
}

interface ChannelGoalsResponse {
  todos: ChannelGoalsTodo[];
  taskSessionIds: string[];
}

/**
 * Bet 2 — channel goals rail. Renders a compact strip of in-flight
 * commitments for the current channel. Reads from `/api/channels/
 * [id]/open-goals` and refreshes on the `commitment:*` socket events
 * emitted by the daemon (Bet 4). Empty state collapses to a hint;
 * full state shows owner + deliverable + age.
 *
 * Deliberately a deterministic projection of the database — NOT an
 * LLM-driven summary, NOT an orchestrator-as-agent. Coordination
 * state lives in `task_sessions` + `todos`; this is the read view.
 */
export function ChannelGoalsStrip({
  organizationId,
  channelId,
  memberNameLookup,
}: {
  organizationId: string;
  channelId: string;
  memberNameLookup: (memberId: string) => string | undefined;
}): JSX.Element | null {
  const [todos, setTodos] = useState<ChannelGoalsTodo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!organizationId || !channelId) return;
    inflightRef.current?.abort();
    const ac = new AbortController();
    inflightRef.current = ac;
    try {
      const res = await fetch(
        `/api/channels/${encodeURIComponent(channelId)}/open-goals?organizationId=${encodeURIComponent(organizationId)}`,
        { signal: ac.signal },
      );
      if (!res.ok) {
        setError(`Goals unavailable (${res.status})`);
        return;
      }
      const body = (await res.json()) as ChannelGoalsResponse;
      setTodos(body.todos ?? []);
      setError(null);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load channel goals.");
    }
  }, [channelId, organizationId]);

  useEffect(() => {
    // Defer the first fetch one microtask so the effect body itself
    // doesn't trigger setState synchronously (react-hooks lint rule).
    // The real-world UX is identical — the rail paints empty for one
    // tick before the data lands.
    const initial = setTimeout(() => {
      void refresh();
    }, 0);
    // Light polling so the rail stays roughly fresh even without the
    // socket subscription. Cheap query (single indexed join); 15s is
    // generous enough not to thrash and short enough to feel live.
    const interval = setInterval(() => void refresh(), 15_000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      inflightRef.current?.abort();
    };
  }, [refresh]);

  const items = useMemo(() => {
    return todos.slice(0, 6);
  }, [todos]);

  if (error) {
    return (
      <div className="border-b border-zinc-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 dark:border-zinc-800 dark:bg-amber-950 dark:text-amber-200">
        Channel goals temporarily unavailable: {error}
      </div>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[11px] text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
      <span className="flex shrink-0 items-center gap-1 font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <Target className="h-3 w-3" />
        Open in channel
      </span>
      {items.map((todo) => {
        const ownerName = memberNameLookup(todo.memberId) ?? todo.memberId;
        const dueLabel = todo.dueAt ? formatDue(todo.dueAt) : undefined;
        const ageLabel = todo.lastProgressAt ? formatAge(todo.lastProgressAt) : undefined;
        const badgeTone = todo.status === "blocked" ? "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200" : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200";
        return (
          <span
            key={todo.id}
            className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 ${badgeTone}`}
            title={todo.deliverableSummary ?? todo.title}
          >
            <span className="font-semibold">{ownerName}</span>
            <span className="text-zinc-500 dark:text-zinc-400">·</span>
            <span className="truncate" style={{ maxWidth: "16rem" }}>
              {todo.deliverableSummary ?? todo.title}
            </span>
            {dueLabel ? (
              <>
                <span className="text-zinc-400 dark:text-zinc-500">·</span>
                <span className="flex items-center gap-0.5 text-zinc-500 dark:text-zinc-400">
                  <Clock className="h-2.5 w-2.5" />
                  {dueLabel}
                </span>
              </>
            ) : null}
            {ageLabel && !dueLabel ? (
              <>
                <span className="text-zinc-400 dark:text-zinc-500">·</span>
                <span className="text-zinc-500 dark:text-zinc-400">{ageLabel}</span>
              </>
            ) : null}
          </span>
        );
      })}
      {todos.length > items.length ? (
        <span className="shrink-0 text-zinc-500 dark:text-zinc-400">+{todos.length - items.length} more</span>
      ) : null}
    </div>
  );
}

function formatDue(dueIso: string): string {
  const due = new Date(dueIso).getTime();
  if (!Number.isFinite(due)) return "";
  const diff = due - Date.now();
  if (diff <= 0) return "overdue";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `due in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `due in ${hours}h`;
  const days = Math.round(hours / 24);
  return `due in ${days}d`;
}

function formatAge(progressIso: string): string {
  const t = new Date(progressIso).getTime();
  if (!Number.isFinite(t)) return "";
  const minutes = Math.round((Date.now() - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
