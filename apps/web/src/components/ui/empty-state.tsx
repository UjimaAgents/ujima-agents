"use client";

import type { LucideIcon } from "lucide-react";
import {
  File,
  Inbox,
  MessageSquare,
  Users,
  Activity,
  ClipboardCheck,
  Search,
} from "lucide-react";

type EmptyStateContext =
  | "messages"
  | "members"
  | "approvals"
  | "tasks"
  | "files"
  | "activity"
  | "search"
  | "generic";

const contextDefaults: Record<
  EmptyStateContext,
  {
    icon: LucideIcon;
    title: string;
    description: string;
  }
> = {
  messages: {
    icon: MessageSquare,
    title: "No messages yet",
    description: "Start the conversation by sending a message.",
  },
  members: {
    icon: Users,
    title: "No members",
    description: "Add members to this channel to collaborate.",
  },
  approvals: {
    icon: ClipboardCheck,
    title: "No approvals",
    description: "Pending approvals will appear here.",
  },
  tasks: {
    icon: ClipboardCheck,
    title: "No active tasks",
    description: "Tasks assigned to agents will appear here.",
  },
  files: {
    icon: File,
    title: "No attachments",
    description: "Files shared in this conversation will appear here.",
  },
  activity: {
    icon: Activity,
    title: "No activity",
    description: "Recent activity will appear here.",
  },
  search: {
    icon: Search,
    title: "No results found",
    description: "Try a different search term.",
  },
  generic: {
    icon: Inbox,
    title: "Nothing here",
    description: "",
  },
};

interface EmptyStateProps {
  context?: EmptyStateContext;
  title?: string;
  description?: string;
  icon?: LucideIcon;
  action?: {
    label: string;
    onClick: () => void;
  };
}

/** Rich empty state with icon, title, description, and optional action button. */
export function EmptyState({
  context = "generic",
  title: customTitle,
  description: customDescription,
  icon: customIcon,
  action,
}: EmptyStateProps) {
  const defaults = contextDefaults[context];
  const Icon = customIcon ?? defaults.icon;
  const title = customTitle ?? defaults.title;
  const description = customDescription ?? defaults.description;

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
        <Icon className="h-6 w-6 text-zinc-400 dark:text-zinc-500" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h3>
      {description && (
        <p className="mt-1 max-w-xs text-center text-xs text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
