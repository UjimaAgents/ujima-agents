"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { SettingsNav, type SettingsNavGroup } from "./settings-nav";

const SettingsTabActionsContext = createContext<{
  setActions: (node: ReactNode) => void;
} | null>(null);

export function SettingsTabActions({ children }: { children: ReactNode }) {
  const ctx = useContext(SettingsTabActionsContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setActions(children);
    return () => ctx.setActions(null);
  }, [children, ctx]);
  return null;
}

function flatNavItems<T extends string>(groups: SettingsNavGroup<T>[]) {
  return groups.flatMap((g) => g.items);
}

function labelForTab<T extends string>(groups: SettingsNavGroup<T>[], activeTab: T) {
  return flatNavItems(groups).find((item) => item.id === activeTab)?.label ?? String(activeTab);
}

export function SettingsLayout<T extends string>({
  groups,
  activeTab,
  onTabChange,
  children,
}: {
  groups: SettingsNavGroup<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  children: ReactNode;
}) {
  const activeLabel = labelForTab(groups, activeTab);
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);

  return (
    <SettingsTabActionsContext.Provider value={{ setActions: setHeaderActions }}>
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-row">
          <aside className="w-48 shrink-0 border-r border-zinc-200 bg-zinc-50/80 p-3 sm:w-52 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <SettingsNav groups={groups} activeTab={activeTab} onTabChange={onTabChange} />
          </aside>

          <div className="min-w-0 flex-1 p-4 sm:p-5 lg:p-6">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {activeLabel}
              </h2>
              {headerActions ? (
                <div className="flex flex-wrap items-center justify-end gap-2">{headerActions}</div>
              ) : null}
            </div>
            <div className="space-y-6">{children}</div>
          </div>
        </div>
      </div>
    </SettingsTabActionsContext.Provider>
  );
}
