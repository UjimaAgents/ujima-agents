import { Hash, MoreHorizontal, Users } from "lucide-react";
import { Avatar, StatusBadge, type StatusVariant } from "./primitives";

export interface ChatHeaderProps {
  /** Channel name, DM contact name, or agent name */
  title: string;
  /** "channel" | "dm" | "group" — drives the icon */
  type: "channel" | "dm" | "group";
  /** Avatar label for DM / agent conversations */
  avatarName?: string;
  /** Stable color used for DM / agent avatars */
  avatarColorIndex?: number;
  /** Online status */
  status?: StatusVariant;
  statusLabel?: string;
  /** Optional right-side context label (e.g. workspace name) */
  contextLabel?: string;
  contextValue?: string;
  /** Slot for extra actions on the right */
  actions?: React.ReactNode;
}

export function ChatHeader({
  title,
  type,
  avatarName,
  avatarColorIndex = 0,
  status = "active",
  statusLabel = "Active",
  contextLabel,
  contextValue,
  actions,
}: ChatHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {type === "channel" ? (
            <Hash className="h-4 w-4 text-zinc-400" />
          ) : type === "group" ? (
            <Users className="h-4 w-4 text-zinc-400" />
          ) : (
            <Avatar
              name={avatarName ?? title}
              colorIndex={avatarColorIndex}
              size="xs"
            />
          )}
          <h1 className="text-sm font-bold text-zinc-900 dark:text-white">
            {title}
          </h1>
          {type === "channel" ? (
            <StatusBadge variant={status} label={statusLabel} />
          ) : (
            <div
              className={`h-2 w-2 rounded-full ${
                status === "active"
                  ? "bg-emerald-500"
                  : status === "idle"
                    ? "bg-amber-500"
                    : "bg-zinc-300 dark:bg-zinc-700"
              }`}
              />
            )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {contextLabel && contextValue && (
          <div className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 dark:border-zinc-800 dark:bg-zinc-900">
            <span className="text-[10px] font-medium text-zinc-500">
              {contextLabel}:
            </span>
            <span className="text-[10px] font-bold text-zinc-900 dark:text-white">
              {contextValue}
            </span>
          </div>
        )}
        {actions}
        <button className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
