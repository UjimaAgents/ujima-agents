"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";
import { SettingsPrimaryButton } from "@/features/settings/shared/settings-buttons";

interface ProcedureSummary {
  scope: "org" | "channel" | "agent";
  scopeId: string;
  name: string;
  description: string;
  version: number;
  enforced: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

interface ProcedureDetail extends ProcedureSummary {
  body: string;
  createdBy: string;
}

interface ListResponse {
  procedures: ProcedureSummary[];
}

interface DetailResponse {
  procedure: ProcedureDetail;
}

interface ApiError {
  code?: string;
  message: string;
}

export interface CultureTabProps {
  organizationId: string;
  channelId: string | null;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

function endpointBase(channelId: string | null): string {
  return channelId
    ? `/api/channels/${encodeURIComponent(channelId)}/culture`
    : `/api/settings/culture`;
}

async function errorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const body = (await response.json().catch(() => null)) as ApiError | null;
  return body?.message ?? `${fallback} (${response.status}).`;
}

export function CultureTab({ organizationId, channelId }: CultureTabProps) {
  const [items, setItems] = useState<ProcedureSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    name: string;
    body: string;
    description: string;
    enforced: boolean;
    existing: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const inflightRef = useRef<AbortController | null>(null);

  const isOrg = channelId === null;
  const base = useMemo(() => endpointBase(channelId), [channelId]);

  const refresh = useCallback(async () => {
    if (!organizationId) return;
    inflightRef.current?.abort();
    const ac = new AbortController();
    inflightRef.current = ac;
    setLoading(true);
    try {
      const res = await fetch(
        `${base}?organizationId=${encodeURIComponent(organizationId)}`,
        { signal: ac.signal },
      );
      if (!res.ok) {
        setError(await errorMessage(res, "Failed to load"));
        setLoading(false);
        return;
      }
      const body = (await res.json()) as ListResponse;
      setItems(body.procedures ?? []);
      setError(null);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [base, organizationId]);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    return () => {
      clearTimeout(initial);
      inflightRef.current?.abort();
    };
  }, [refresh]);

  const beginAdd = () => {
    setEditing({
      name: "",
      body: "",
      description: "",
      enforced: false,
      existing: false,
    });
  };

  const beginEdit = async (name: string) => {
    setError(null);
    try {
      const res = await fetch(
        `${base}/${encodeURIComponent(name)}?organizationId=${encodeURIComponent(organizationId)}`,
      );
      if (!res.ok) {
        setError(await errorMessage(res, "Failed to load procedure"));
        return;
      }
      const body = (await res.json()) as DetailResponse;
      setEditing({
        name: body.procedure.name,
        description: body.procedure.description,
        body: body.procedure.body,
        enforced: body.procedure.enforced,
        existing: true,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load procedure.",
      );
    }
  };

  const cancelEdit = () => setEditing(null);

  const submit = async () => {
    if (!editing) return;
    if (!NAME_PATTERN.test(editing.name)) {
      setError("Name must be lowercase letters, digits, hyphens (2-64 chars).");
      return;
    }
    if (editing.description.trim().length < 1) {
      setError("Description is required.");
      return;
    }
    if (editing.body.trim().length < 1) {
      setError("Body is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          name: editing.name,
          description: editing.description.trim(),
          body: editing.body,
          enforced: isOrg ? editing.enforced : false,
        }),
      });
      if (!res.ok) {
        setError(await errorMessage(res, "Save failed"));
        return;
      }
      setEditing(null);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    if (!window.confirm(`Remove "${name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${base}/${encodeURIComponent(name)}?organizationId=${encodeURIComponent(organizationId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        setError(await errorMessage(res, "Remove failed"));
        return;
      }
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed.");
    } finally {
      setBusy(false);
    }
  };

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {isOrg ? "Workspace Culture" : "Channel Culture"}
          </h3>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {isOrg
              ? "Cultural norms that apply across this organization."
              : "Norms specific to this channel."}
          </p>
        </div>
        {!editing ? (
          <SettingsPrimaryButton onClick={beginAdd}>
            Add procedure
          </SettingsPrimaryButton>
        ) : null}
      </header>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {editing ? (
        <div className="space-y-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Name
            </label>
            <input
              className="mt-1 block w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              value={editing.name}
              disabled={editing.existing}
              placeholder="pages-stay-open"
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Lowercase letters, digits, hyphens (2-64 characters). Cannot be
              changed after creation.
            </p>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Description
            </label>
            <input
              className="mt-1 block w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              value={editing.description}
              maxLength={200}
              placeholder="One sentence: what this procedure enforces."
              onChange={(e) =>
                setEditing({ ...editing, description: e.target.value })
              }
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Body
            </label>
            <textarea
              className="mt-1 block w-full rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              rows={8}
              value={editing.body}
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              placeholder="When you ... do ..."
            />
          </div>
          {isOrg ? (
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={editing.enforced}
                onChange={(e) =>
                  setEditing({ ...editing, enforced: e.target.checked })
                }
              />
              <ShieldCheck className="h-4 w-4 text-amber-600" aria-hidden />
              Mark as LAW (max 3 per org).
            </label>
          ) : null}
          <div className="flex gap-2 pt-1">
            <SettingsPrimaryButton
              onClick={() => void submit()}
              disabled={busy}
            >
              {busy ? "Saving…" : editing.existing ? "Save changes" : "Create"}
            </SettingsPrimaryButton>
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded border border-zinc-300 px-3 py-1 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      ) : sortedItems.length === 0 && !editing ? (
        <div className="rounded border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No {isOrg ? "workspace" : "channel"} culture yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {sortedItems.map((item) => (
            <li
              key={item.name}
              className="flex items-start justify-between gap-3 rounded border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-zinc-900 dark:text-zinc-100">
                    {item.name}
                  </span>
                  {item.enforced ? (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                      <ShieldCheck className="h-3 w-3" aria-hidden /> LAW
                    </span>
                  ) : null}
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    v{item.version}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-sm text-zinc-600 dark:text-zinc-300">
                  {item.description}
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                  Updated {item.updatedAt} by {item.updatedBy}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void beginEdit(item.name)}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void remove(item.name)}
                  className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
