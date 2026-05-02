import { Hash, Users, UserCircle, type LucideIcon } from "lucide-react";

/** Reusable avatar colors — consistent across channel, DM, and agent views. */
const AVATAR_COLORS = [
  "bg-violet-500",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
  "bg-orange-500",
] as const;

export function getAvatarColor(index: number) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

export function getInitials(name: string) {
  return name
    .split(/[-\s]+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}

/* ── Status badge (Active, Idle, Offline, etc.) ────────────────────── */
export type StatusVariant = "active" | "idle" | "offline" | "error";

const STATUS_STYLES: Record<StatusVariant, string> = {
  active:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  idle: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  offline:
    "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
  error: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400",
};

export function StatusBadge({
  variant,
  label,
}: {
  variant: StatusVariant;
  label: string;
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[variant]}`}
    >
      {label}
    </span>
  );
}

/* ── Tag badge (Planning, Analysis, Completed, etc.) ───────────────── */
export type TagVariant = "planning" | "analysis" | "completed" | "default";

const TAG_STYLES: Record<TagVariant, string> = {
  planning:
    "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  analysis:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400",
  completed:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  default:
    "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function TagBadge({
  variant = "default",
  label,
}: {
  variant?: TagVariant;
  label: string;
}) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${TAG_STYLES[variant]}`}
    >
      {label}
    </span>
  );
}

/* ── Avatar (single member) ────────────────────────────────────────── */
export function Avatar({
  name,
  colorIndex = 0,
  size = "md",
}: {
  name: string;
  colorIndex?: number;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const dims = size === "xs" ? "h-5 w-5 text-[8px]" : size === "sm" ? "h-7 w-7 text-[10px]" : size === "lg" ? "h-12 w-12 text-sm" : "h-9 w-9 text-xs";
  return (
    <div
      className={`${dims} shrink-0 rounded-lg flex items-center justify-center text-white font-bold ${getAvatarColor(colorIndex)}`}
    >
      {getInitials(name)}
    </div>
  );
}

/* ── Avatar stack (multiple members) ───────────────────────────────── */
export function AvatarStack({
  members,
  max = 4,
}: {
  members: { id: string; name: string }[];
  max?: number;
}) {
  const visible = members.slice(0, max);
  const remaining = Math.max(members.length - max, 0);
  return (
    <div className="flex items-center -space-x-2">
      {visible.map((m, i) => (
        <div
          key={m.id}
          className={`h-7 w-7 rounded-full border-2 border-white dark:border-[#09090b] flex items-center justify-center text-[10px] font-bold text-white ${getAvatarColor(i)}`}
        >
          {m.name.charAt(0).toUpperCase()}
        </div>
      ))}
      {remaining > 0 && (
        <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-zinc-100 text-[10px] font-bold text-zinc-500 dark:border-[#09090b] dark:bg-zinc-800">
          +{remaining}
        </div>
      )}
    </div>
  );
}

/* ── Channel / DM header icon resolver ─────────────────────────────── */
export function ConversationIcon({
  type,
  className = "h-5 w-5 text-zinc-400",
}: {
  type: "channel" | "dm" | "group";
  className?: string;
}) {
  const Icon: LucideIcon = type === "channel" ? Hash : type === "group" ? Users : UserCircle;
  return <Icon className={className} />;
}
