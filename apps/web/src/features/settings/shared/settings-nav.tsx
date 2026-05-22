"use client";

import type { LucideIcon } from "lucide-react";

export interface SettingsNavItem<T extends string = string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

export interface SettingsNavGroup<T extends string = string> {
  label: string;
  items: SettingsNavItem<T>[];
}

export function SettingsNav<T extends string>({
  groups,
  activeTab,
  onTabChange,
}: {
  groups: SettingsNavGroup<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
}) {
  return (
    <nav className="space-y-5" aria-label="Settings sections">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === activeTab;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onTabChange(item.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition sm:gap-2.5 sm:rounded-xl sm:px-3 sm:text-sm ${
                      isActive
                        ? "bg-violet-600 text-white"
                        : "text-zinc-600 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

