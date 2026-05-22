"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FolderKanban, Loader2, Plus, RefreshCw } from "lucide-react";
import { switchToWorkspace } from "@/features/workspace/switch-workspace";
import { SettingsErrorAlert, SettingsLoading } from "@/features/settings/shared/settings-alert";
import {
  SettingsPrimaryButton,
  SettingsSecondaryButton,
} from "@/features/settings/shared/settings-buttons";
import { SettingsEmptyState } from "@/features/settings/shared/settings-empty-state";
import { SettingsTabActions } from "@/features/settings/shared/settings-layout";
import { SettingsList, SettingsListRow } from "@/features/settings/shared/settings-list-row";
import { WorkspaceCreateModal } from "./workspaces/workspace-create-modal";

interface Workspace {
  id: string;
  root_path: string | null;
  label: string | null;
  created_at: number;
  updated_at: number;
  is_current?: boolean;
}

interface WorkspacesTabProps {
  currentWorkspaceRoot?: string;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isCurrentWorkspace(
  rootPath: string | null,
  currentWorkspaceRoot: string | undefined,
  isCurrentFlag?: boolean,
): boolean {
  if (isCurrentFlag) return true;
  if (!rootPath || !currentWorkspaceRoot?.trim()) return false;
  return normalizePath(rootPath) === normalizePath(currentWorkspaceRoot);
}

export function WorkspacesTab({ currentWorkspaceRoot }: WorkspacesTabProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWorkspaces = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces");
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Unable to fetch workspaces");
      }
      const data = await res.json();
      setWorkspaces(data.workspaces ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspaces");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetched = useRef(false);
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    void fetchWorkspaces();
  }, [fetchWorkspaces]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchWorkspaces().catch(() => undefined);
    setRefreshing(false);
  };

  const createWorkspace = async (name: string, rootPath: string) => {
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        root_path: rootPath,
        label: name,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message || "Failed to create workspace");
    }
    const created = (await res.json()) as Workspace;
    setWorkspaces((prev) => {
      if (prev.some((ws) => ws.id === created.id)) return prev;
      return [...prev, created];
    });
    await fetchWorkspaces();
  };

  const handleSwitch = async (workspaceId: string) => {
    setSwitchingId(workspaceId);
    setError(null);
    try {
      await switchToWorkspace(workspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to switch workspace");
      setSwitchingId(null);
    }
  };

  const sortedWorkspaces = [...workspaces].sort((a, b) => {
    const aCurrent = isCurrentWorkspace(a.root_path, currentWorkspaceRoot, a.is_current);
    const bCurrent = isCurrentWorkspace(b.root_path, currentWorkspaceRoot, b.is_current);
    if (aCurrent === bCurrent) return 0;
    return aCurrent ? -1 : 1;
  });

  if (loading) {
    return <SettingsLoading label="Loading workspaces…" />;
  }

  return (
    <>
      <SettingsTabActions>
        <SettingsSecondaryButton
          disabled={refreshing}
          onClick={() => void handleRefresh()}
          title="Refresh list"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </SettingsSecondaryButton>
        <SettingsPrimaryButton onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New workspace
        </SettingsPrimaryButton>
      </SettingsTabActions>

      {error ? <SettingsErrorAlert message={error} /> : null}

      {sortedWorkspaces.length === 0 && !error ? (
        <SettingsEmptyState
          icon={FolderKanban}
          title="No workspaces yet"
          description="Add another workspace when you want a separate project folder and team."
          action={
            <SettingsPrimaryButton onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New workspace
            </SettingsPrimaryButton>
          }
        />
      ) : (
        <SettingsList>
          {sortedWorkspaces.map((ws) => {
            const current = isCurrentWorkspace(ws.root_path, currentWorkspaceRoot, ws.is_current);
            const busy = switchingId === ws.id;

            return (
              <SettingsListRow
                key={ws.id}
                leading={<FolderKanban className="h-4 w-4 text-violet-600 dark:text-violet-400" />}
                primary={ws.label || ws.id}
                secondary={ws.root_path || "—"}
                badge={
                  current ? (
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
                      Active
                    </span>
                  ) : null
                }
                actions={
                  current ? null : (
                    <SettingsSecondaryButton
                      disabled={Boolean(switchingId)}
                      onClick={() => void handleSwitch(ws.id)}
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Switch
                    </SettingsSecondaryButton>
                  )
                }
              />
            );
          })}
        </SettingsList>
      )}

      <WorkspaceCreateModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={createWorkspace}
      />
    </>
  );
}
