"use client";

import { Check, ChevronDown, Command, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BootstrapResponse } from "@ujima/api-schema";
import { orgWorkspaceId } from "@ujima/shared/browser";
import { switchToWorkspace } from "@/features/workspace/switch-workspace";
import { listItemIdle, listItemSelectedNeutral } from "@/lib/list-item-styles";

export function WorkspaceSwitcher({
  bootstrap,
}: {
  bootstrap: BootstrapResponse;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const workspaces = bootstrap.organizations;
  const activeId = bootstrap.organization?.id;
  const displayLabel = bootstrap.organization?.name ?? "Workspace";

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const handleSwitch = async (orgId: string, isActive: boolean) => {
    setOpen(false);
    if (isActive || switchingId) return;
    setError(null);
    setSwitchingId(orgId);
    try {
      await switchToWorkspace(router, orgWorkspaceId(orgId));
    } catch (err) {
      setSwitchingId(null);
      setError(err instanceof Error ? err.message : "Unable to switch workspace");
    }
  };

  if (workspaces.length <= 1) {
    return (
      <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          <Command className="h-4 w-4" />
        </div>
        <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {displayLabel}
        </span>
      </div>
    );
  }

  return (
    <div ref={menuRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={Boolean(switchingId)}
        className="flex max-w-full items-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left transition hover:bg-zinc-50 disabled:opacity-70 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {switchingId ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Command className="h-4 w-4" />
          )}
        </div>
        <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {switchingId ? "Switching…" : displayLabel}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
      </button>

      {error ? (
        <p className="absolute left-0 top-full z-50 mt-1 max-w-xs text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            Workspaces
          </p>
          {workspaces.map((org) => {
            const active = org.id === activeId;
            const busy = switchingId === org.id;
            return (
              <button
                key={org.id}
                type="button"
                disabled={Boolean(switchingId)}
                onClick={() => void handleSwitch(org.id, active)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition disabled:opacity-60 ${
                  active ? listItemSelectedNeutral : listItemIdle
                }`}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
                <span className="flex-1 truncate font-medium">{org.name}</span>
                {active ? <Check className="h-3.5 w-3.5 shrink-0 text-zinc-500" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
