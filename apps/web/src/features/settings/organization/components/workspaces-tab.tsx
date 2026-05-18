"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FolderKanban, RefreshCw, AlertCircle, Plus, Trash2, Loader2 } from "lucide-react";
import { TextInput } from "@/components/ui/form-fields";
import { reloadAfterWorkspaceSwitch, switchWorkspace } from "@/features/workspace/switch-workspace";

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
  const [showCreate, setShowCreate] = useState(false);
  const [newRootPath, setNewRootPath] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [isPickingRoot, setIsPickingRoot] = useState(false);
  const [rootPickError, setRootPickError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

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
    fetchWorkspaces().catch(() => undefined);
  }, [fetchWorkspaces]);

  const pickWorkspaceRoot = async () => {
    setRootPickError(null);
    setIsPickingRoot(true);
    try {
      const response = await fetch("/api/onboarding/pick-workspace-root", { method: "POST" });
      const body = (await response.json().catch(() => null)) as
        | { path?: string; cancelled?: boolean; message?: string }
        | null;

      if (!response.ok) {
        throw new Error(body?.message ?? "Unable to open folder picker.");
      }

      if (body?.path) {
        setNewRootPath(body.path);
      }
    } catch (err) {
      setRootPickError(err instanceof Error ? err.message : "Unable to open folder picker.");
    } finally {
      setIsPickingRoot(false);
    }
  };

  const createWorkspace = async () => {
    if (!newRootPath.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root_path: newRootPath.trim(), label: newLabel.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to create workspace");
      }
      setShowCreate(false);
      setNewRootPath("");
      setNewLabel("");
      setRootPickError(null);
      await fetchWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  const deleteWorkspace = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to delete workspace");
      }
      setWorkspaces((prev) => prev.filter((w) => w.id !== id));
      setDeleteConfirm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleSwitch = async (workspaceId: string) => {
    setSwitchingId(workspaceId);
    setError(null);
    try {
      await switchWorkspace(workspaceId);
      reloadAfterWorkspaceSwitch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to switch workspace");
      setSwitchingId(null);
    }
  };

  const formatDate = (ts: number) => new Date(ts).toLocaleString();

  const sortedWorkspaces = [...workspaces].sort((a, b) => {
    const aCurrent = isCurrentWorkspace(a.root_path, currentWorkspaceRoot, a.is_current);
    const bCurrent = isCurrentWorkspace(b.root_path, currentWorkspaceRoot, b.is_current);
    if (aCurrent === bCurrent) return 0;
    return aCurrent ? -1 : 1;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="h-5 w-5 animate-spin text-zinc-400" />
        <span className="ml-3 text-sm text-zinc-500">Loading workspaces...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Workspaces define filesystem roots for agent operations.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchWorkspaces()}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700"
          >
            <Plus className="h-3.5 w-3.5" />
            New workspace
          </button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/30 dark:bg-red-500/10">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
        </div>
      ) : null}

      {showCreate ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-500/30 dark:bg-violet-500/5">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Workspace root path
              </label>
              <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                Browse opens a native folder dialog when this app runs on your machine (local dev).
              </p>
              <div className="flex gap-2">
                <TextInput
                  type="text"
                  placeholder="C:\Users\you\projects\my-project"
                  value={newRootPath}
                  onChange={(e) => setNewRootPath(e.target.value)}
                  className="flex-1 bg-white dark:bg-zinc-900"
                />
                <button
                  type="button"
                  onClick={() => void pickWorkspaceRoot()}
                  disabled={isPickingRoot}
                  className="shrink-0 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  {isPickingRoot ? "Opening..." : "Browse"}
                </button>
              </div>
              {rootPickError ? (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{rootPickError}</p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Label (optional)
              </label>
              <TextInput
                type="text"
                placeholder="My Project"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="bg-white dark:bg-zinc-900"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void createWorkspace()}
                disabled={!newRootPath.trim() || saving}
                className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? "Creating..." : "Create"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  setNewRootPath("");
                  setNewLabel("");
                  setRootPickError(null);
                }}
                className="rounded-xl px-4 py-2 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {sortedWorkspaces.length === 0 && !error ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-16 dark:border-zinc-700 dark:bg-zinc-900/50">
          <FolderKanban className="mb-4 h-10 w-10 text-zinc-300 dark:text-zinc-600" />
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">No workspaces yet</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Create a workspace to define a filesystem root for agents.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedWorkspaces.map((ws) => {
            const current = isCurrentWorkspace(ws.root_path, currentWorkspaceRoot, ws.is_current);
            const busy = switchingId === ws.id;
            return (
              <div
                key={ws.id}
                className={`flex items-start gap-4 rounded-2xl border p-4 ${
                  current
                    ? "border-violet-300 bg-violet-50/50 dark:border-violet-500/40 dark:bg-violet-500/5"
                    : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                }`}
              >
                <button
                  type="button"
                  disabled={Boolean(switchingId)}
                  onClick={() => {
                    if (!current) void handleSwitch(ws.id);
                  }}
                  className={`flex min-w-0 flex-1 text-left ${
                    current ? "cursor-default" : "cursor-pointer rounded-xl transition hover:opacity-90"
                  }`}
                >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-3">
                    {busy ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-600" />
                    ) : (
                      <FolderKanban className="h-4 w-4 text-violet-600 shrink-0" />
                    )}
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {ws.label || ws.id}
                    </span>
                    {current ? (
                      <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                        Current
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                        Click to switch
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                    {ws.root_path || "—"}
                  </p>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    Created: {formatDate(ws.created_at)}
                  </p>
                </div>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {deleteConfirm === ws.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void deleteWorkspace(ws.id)}
                        className="rounded-lg bg-red-600 px-2 py-1.5 text-[10px] font-semibold text-white transition hover:bg-red-700"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(null)}
                        className="rounded-lg px-2 py-1.5 text-[10px] font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(ws.id)}
                      title={current ? "Cannot delete the active workspace" : "Delete"}
                      disabled={current || Boolean(switchingId)}
                      className="rounded-lg p-2 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
