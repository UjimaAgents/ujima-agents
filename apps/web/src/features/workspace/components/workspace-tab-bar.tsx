"use client";

import {
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  Hash,
  Menu,
  Plus,
  Workflow,
  X,
  MessageSquare,
  PanelRight,
} from "lucide-react";
import { Avatar } from "./chat/primitives";
import type { SelectedConversation } from "../types";

export interface WorkspaceTabItem {
  id: string; // e.g. "view:tasks", "channel:c1", "agent:a1", "view:workflows"
  type: "tasks" | "workflows" | "channel" | "agent";
  title: string;
  targetId?: string;
  conversation?: SelectedConversation;
}

interface WorkspaceTabBarProps {
  openTabs: WorkspaceTabItem[];
  activeTabId: string;
  onSelectTab: (tab: WorkspaceTabItem) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab?: () => void;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
  showDetails?: boolean;
  onToggleDetails?: () => void;
  /** Mobile-only hamburger that opens the sidebar as an overlay drawer. */
  onToggleSidebar?: () => void;
}

export function WorkspaceTabBar({
  openTabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onNavigateBack,
  onNavigateForward,
  canNavigateBack = false,
  canNavigateForward = false,
  showDetails = false,
  onToggleDetails,
  onToggleSidebar,
}: WorkspaceTabBarProps) {
  return (
    <div className="flex h-10 w-full shrink-0 select-none items-center overflow-hidden border-b border-zinc-200/80 bg-zinc-100/60 px-2 dark:border-zinc-800/80 dark:bg-zinc-950/80 z-20">
      {/* Mobile sidebar toggle */}
      {onToggleSidebar ? (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Open sidebar"
          title="Open sidebar"
          className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200/60 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 md:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>
      ) : null}
      {/* Navigation history controls */}
      <div className="flex items-center gap-0.5 pr-2 shrink-0 border-r border-zinc-200/60 dark:border-zinc-800/60 mr-1">
        <button
          type="button"
          onClick={onNavigateBack}
          disabled={!canNavigateBack}
          className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 dark:text-zinc-400 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          title="Go back"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onNavigateForward}
          disabled={!canNavigateForward}
          className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 dark:text-zinc-400 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          title="Go forward"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs list */}
      <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto no-scrollbar">
        {openTabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab)}
              className={`group relative flex items-center gap-2 h-7 px-2.5 max-w-[180px] min-w-[110px] rounded-t-lg border border-b-0 transition-all cursor-pointer ${
                isActive
                  ? "bg-white dark:bg-[#09090b] border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold shadow-xs"
                  : "bg-transparent border-transparent text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/40 dark:hover:bg-zinc-900/40 hover:text-zinc-800 dark:hover:text-zinc-200 font-medium"
              }`}
            >
              {/* Tab Icon */}
              <div className="shrink-0">
                {tab.type === "tasks" ? (
                  <FolderKanban className="h-3.5 w-3.5 text-violet-500" />
                ) : tab.type === "workflows" ? (
                  <Workflow className="h-3.5 w-3.5 text-indigo-500" />
                ) : tab.type === "channel" ? (
                  <Hash className="h-3.5 w-3.5 text-zinc-400" />
                ) : tab.type === "agent" ? (
                  <Avatar name={tab.title} size="xs" />
                ) : (
                  <MessageSquare className="h-3.5 w-3.5 text-zinc-400" />
                )}
              </div>

              {/* Tab Title */}
              <span className="truncate text-xs min-w-0 flex-1">{tab.title}</span>

              {/* Close Button */}
              {openTabs.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-opacity ${
                    isActive
                      ? "opacity-60 hover:opacity-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      : "opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                  }`}
                  title="Close tab"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}

        {/* Add new tab button */}
        {onNewTab && (
          <button
            type="button"
            onClick={onNewTab}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors ml-0.5"
            title="Search / Open view"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {onToggleDetails ? (
        <div className="ml-1 flex shrink-0 items-center border-l border-zinc-200/60 pl-1 dark:border-zinc-800/60">
          <button
            type="button"
            onClick={onToggleDetails}
            aria-label={showDetails ? "Hide details sidebar" : "Show details sidebar"}
            aria-pressed={showDetails}
            title={showDetails ? "Hide details sidebar" : "Show details sidebar"}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
              showDetails
                ? "bg-zinc-200/70 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            <PanelRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
