"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookText, PencilLine, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { FieldShell, TextArea, TextInput } from "@/components/ui/form-fields";
import { ConfirmDialog } from "@/features/settings/shared/confirm-dialog";
import { SettingsErrorAlert } from "@/features/settings/shared/settings-alert";
import {
  SettingsBadge,
  SettingsGhostIconButton,
  SettingsPrimaryButton,
  SettingsSecondaryButton,
} from "@/features/settings/shared/settings-buttons";
import { SettingsEmptyState } from "@/features/settings/shared/settings-empty-state";
import { SettingsList, SettingsListRow, SettingsRowIcon } from "@/features/settings/shared/settings-list-row";
import { SettingsSection } from "@/features/settings/shared/settings-section";
import { SettingsTabActions } from "@/features/settings/shared/settings-layout";

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
  members?: readonly { id: string; name: string }[];
}

function endpointBase(channelId: string | null): string {
  return channelId
    ? `/api/channels/${encodeURIComponent(channelId)}/culture`
    : `/api/settings/culture`;
}

function formatProcedureName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

async function errorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const body = (await response.json().catch(() => null)) as ApiError | null;
  return body?.message ?? `${fallback} (${response.status}).`;
}

export const CultureTab = memo(function CultureTab({ organizationId, channelId, members }: CultureTabProps) {
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
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  const isOrg = channelId === null;
  const base = useMemo(() => endpointBase(channelId), [channelId]);
  const memberNames = useMemo(
    () => new Map((members ?? []).map((member) => [member.id, member.name])),
    [members],
  );
  const editingName = editing ? formatProcedureName(editing.name) : "";
  const helperName = editing
    ? editing.existing
      ? "This name is fixed after creation."
      : "We will format this into a file-safe slug on save."
    : "";

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

  const beginAdd = useCallback(() => {
    setEditing({
      name: "",
      body: "",
      description: "",
      enforced: false,
      existing: false,
    });
  }, []);

  const beginEdit = useCallback(async (name: string) => {
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
  }, [base, organizationId]);

  const cancelEdit = useCallback(() => setEditing(null), []);

  const submit = useCallback(async () => {
    if (!editing) return;
    const name = formatProcedureName(editing.name);
    if (!name) {
      setError("Name is required.");
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
          name,
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
  }, [editing, base, organizationId, isOrg, refresh]);

  const remove = useCallback(async () => {
    if (!pendingRemove) return;
    const name = pendingRemove;
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
      setPendingRemove(null);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed.");
    } finally {
      setBusy(false);
    }
  }, [pendingRemove, base, organizationId, refresh]);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );
  const formatUpdatedAt = useCallback((value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(date);
  }, []);
  const formatUpdatedBy = useCallback(
    (value: string) => memberNames.get(value) ?? "Unknown member",
    [memberNames],
  );

  return (
    <div className="space-y-6">
      <SettingsTabActions>
        <SettingsPrimaryButton onClick={beginAdd} disabled={Boolean(editing)}>
          <Sparkles className="h-4 w-4" />
          Add procedure
        </SettingsPrimaryButton>
      </SettingsTabActions>

      {error ? (
        <SettingsErrorAlert message={error} onDismiss={() => setError(null)} />
      ) : null}

      {editing ? (
        <SettingsSection
          title={editing.existing ? "Edit procedure" : "New procedure"}
          description={helperName}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <FieldShell
              label="Name"
              htmlFor="culture-name"
              hint="We turn spaces and punctuation into a clean file name."
            >
              <TextInput
                id="culture-name"
                value={editing.name}
                disabled={editing.existing}
                placeholder="Pages stay open"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                onBlur={() => {
                  if (editing.existing) return;
                  const next = formatProcedureName(editing.name);
                  if (next !== editing.name) setEditing({ ...editing, name: next });
                }}
              />
              {editing.name && !editing.existing ? (
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  Saved as <span className="font-mono text-zinc-700 dark:text-zinc-200">{editingName}</span>
                </p>
              ) : null}
            </FieldShell>

            <FieldShell
              label="Description"
              htmlFor="culture-description"
              hint="Short. Human. One line is enough."
            >
              <TextInput
                id="culture-description"
                value={editing.description}
                maxLength={200}
                placeholder="What this procedure keeps true."
                onChange={(e) =>
                  setEditing({ ...editing, description: e.target.value })
                }
              />
            </FieldShell>
          </div>

          <FieldShell
            label="Body"
            htmlFor="culture-body"
            hint="Write the actual guidance or rule text."
          >
            <TextArea
              id="culture-body"
              rows={8}
              value={editing.body}
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              placeholder="When you ... do ..."
              className="font-mono text-sm"
            />
          </FieldShell>

          {isOrg ? (
            <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={editing.enforced}
                onChange={(e) =>
                  setEditing({ ...editing, enforced: e.target.checked })
                }
                className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
              />
              <ShieldCheck className="h-4 w-4 text-amber-600" aria-hidden />
              Mark as LAW
              <span className="text-zinc-500 dark:text-zinc-400">(max 3 per workspace)</span>
            </label>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <SettingsPrimaryButton
              onClick={() => void submit()}
              disabled={busy}
            >
              {busy ? "Saving…" : editing.existing ? "Save changes" : "Create"}
            </SettingsPrimaryButton>
            <SettingsSecondaryButton onClick={cancelEdit}>
              Cancel
            </SettingsSecondaryButton>
          </div>
        </SettingsSection>
      ) : null}

      <SettingsSection
        title="Procedures"
        description={isOrg ? "Workspace rules and norms." : "Channel-specific norms."}
      >
        {loading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
        ) : sortedItems.length === 0 ? (
          <SettingsEmptyState
            icon={BookText}
            title={`No ${isOrg ? "workspace" : "channel"} culture yet`}
            description="Add one procedure or LAW to make this culture explicit."
            action={!editing ? (
              <SettingsPrimaryButton onClick={beginAdd}>
                <Sparkles className="h-4 w-4" />
                Add procedure
              </SettingsPrimaryButton>
            ) : undefined}
          />
        ) : (
          <SettingsList>
            {sortedItems.map((item) => (
              <SettingsListRow
                key={item.name}
                leading={<SettingsRowIcon icon={Sparkles} />}
                primary={<span className="font-mono">{item.name}</span>}
                secondary={
                  <div className="space-y-1">
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {item.description}
                    </p>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      Updated {formatUpdatedAt(item.updatedAt)} by {formatUpdatedBy(item.updatedBy)}
                    </p>
                  </div>
                }
                badge={
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.enforced ? (
                      <SettingsBadge variant="warning">
                        <ShieldCheck className="h-3 w-3" />
                        LAW
                      </SettingsBadge>
                    ) : null}
                    <SettingsBadge variant="violet">v{item.version}</SettingsBadge>
                  </div>
                }
                actions={
                  <>
                    <SettingsSecondaryButton
                      onClick={() => void beginEdit(item.name)}
                    >
                      <PencilLine className="h-3.5 w-3.5" />
                      Edit
                    </SettingsSecondaryButton>
                    <SettingsGhostIconButton
                      title="Remove procedure"
                      onClick={() => setPendingRemove(item.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </SettingsGhostIconButton>
                  </>
                }
              />
            ))}
          </SettingsList>
        )}
      </SettingsSection>

      <ConfirmDialog
        isOpen={Boolean(pendingRemove)}
        onClose={() => setPendingRemove(null)}
        title="Remove culture pack"
        message={`Remove "${pendingRemove}"?`}
        confirmLabel="Remove"
        busy={busy}
        onConfirm={remove}
      />
    </div>
  );
});
