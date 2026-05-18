"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, FolderKanban, Loader2 } from "lucide-react";
import { reloadAfterWorkspaceSwitch, switchWorkspace } from "../switch-workspace";

interface WorkspaceOption {
  id: string;
  root_path: string | null;
  label: string | null;
  is_current?: boolean;
}

interface WorkspaceSwitcherProps {
  currentWorkspaceRoot?: string;
}

export function WorkspaceSwitcher({ currentWorkspaceRoot }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const fetched = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = 288;
    const left = Math.min(
      Math.max(8, rect.right - width),
      window.innerWidth - width - 8,
    );
    setMenuPosition({
      top: rect.bottom + 6,
      left,
      width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/workspaces");
      const body = (await response.json().catch(() => null)) as
        | { workspaces?: WorkspaceOption[]; message?: string }
        | null;
      if (!response.ok) {
        throw new Error(body?.message ?? "Unable to load workspaces");
      }
      setWorkspaces(body?.workspaces ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load workspaces");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || fetched.current) return;
    fetched.current = true;
    void loadWorkspaces();
  }, [loadWorkspaces, open]);

  const current =
    workspaces.find((ws) => ws.is_current) ??
    workspaces.find(
      (ws) =>
        ws.root_path &&
        currentWorkspaceRoot &&
        normalizePath(ws.root_path) === normalizePath(currentWorkspaceRoot),
    );

  const displayLabel = current?.label ?? folderName(current?.root_path ?? currentWorkspaceRoot);

  const handleSelect = async (workspaceId: string, isCurrent: boolean) => {
    if (isCurrent) {
      setOpen(false);
      return;
    }
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

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={Boolean(switchingId)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex max-w-[200px] items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-left transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
        title={current?.root_path ?? currentWorkspaceRoot ?? "Workspace"}
      >
        {switchingId ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-600" />
        ) : (
          <FolderKanban className="h-4 w-4 shrink-0 text-violet-600" />
        )}
        <span className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">
          {displayLabel || "Workspace"}
        </span>
        <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-zinc-400" />
      </button>

      {open && mounted && menuPosition
        ? createPortal(
            <>
              <div
                className="fixed inset-0 z-[80] bg-zinc-950/25 backdrop-blur-[1px]"
                onClick={() => setOpen(false)}
                aria-hidden
              />
              <div
                role="listbox"
                className="fixed z-[81] isolate max-h-[min(24rem,calc(100vh-5rem))] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-2xl ring-1 ring-zinc-950/5 dark:border-zinc-700 dark:bg-zinc-950 dark:ring-white/10"
                style={{
                  top: menuPosition.top,
                  left: menuPosition.left,
                  width: menuPosition.width,
                }}
              >
                <p className="sticky top-0 z-10 bg-white px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-950">
                  Switch workspace
                </p>
            {loading ? (
              <p className="px-2 py-2 text-xs text-zinc-500">Loading...</p>
            ) : null}
            {error ? (
              <p className="px-2 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>
            ) : null}
            {!loading
              ? workspaces.map((ws) => {
                  const isCurrent = Boolean(ws.is_current);
                  const busy = switchingId === ws.id;
                  return (
                    <button
                      key={ws.id}
                      type="button"
                      disabled={Boolean(switchingId)}
                      onClick={() => void handleSelect(ws.id, isCurrent)}
                      className={`flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left text-xs transition ${
                        isCurrent
                          ? "bg-violet-50 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200"
                          : "bg-white text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                      } disabled:opacity-60`}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        <span className="truncate">{ws.label || ws.id}</span>
                        {isCurrent ? (
                          <span className="ml-auto text-[10px] uppercase tracking-wide text-violet-600">
                            Current
                          </span>
                        ) : null}
                      </span>
                      <span className="truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                        {ws.root_path || "—"}
                      </span>
                    </button>
                  );
                })
              : null}
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function folderName(path?: string | null): string {
  if (!path?.trim()) return "Workspace";
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}
