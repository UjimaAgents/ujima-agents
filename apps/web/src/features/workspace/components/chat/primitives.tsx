import { Hash, Users, UserCircle, ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { TERMINAL_PANEL, TERMINAL_SECTION } from "./terminal-chrome";

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
export function ConversationIcon({  type,
  className = "h-5 w-5 text-zinc-400",
}: {
  type: "channel" | "dm" | "group";
  className?: string;
}) {
  const Icon: LucideIcon = type === "channel" ? Hash : type === "group" ? Users : UserCircle;
  return <Icon className={className} />;
}

/* ── Terminal-style tool pane shell (shared header/body frame) ─────── */
export function ToolPane({
  className = "",
  sectionClassName = "",
  header,
  children,
}: {
  className?: string;
  sectionClassName?: string;
  header: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={`${TERMINAL_PANEL} ${className}`}>
      <div className={`${TERMINAL_SECTION} ${sectionClassName}`}>{header}</div>
      {children}
    </div>
  );
}

/* ── Expandable trace row (shared by run panel & skill pane) ───────── */
export function Chevron({ open }: { open: boolean }) {
  return open ? (
    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground/45" />
  ) : (
    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground/45" />
  );
}

const ROW_BUTTON_CLASS =
  "trace-step-text flex min-h-5 w-full flex-wrap items-center gap-2 text-foreground/70 hover:text-foreground/90 text-left transition-colors";

export function ExpandableRow({
  expanded,
  onToggle,
  header,
  trailing,
  indent = false,
  className = "",
  children,
}: {
  expanded: boolean;
  onToggle: (e: React.MouseEvent) => void;
  header: React.ReactNode;
  trailing?: React.ReactNode;
  indent?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`animate-in fade-in duration-200 ${indent ? "pl-2" : ""} ${className}`}>
      <button type="button" onClick={onToggle} className={ROW_BUTTON_CLASS}>
        <span className="flex-1 min-w-0 truncate text-left">{header}</span>
        {trailing && <span className="shrink-0 ml-auto mr-1.5">{trailing}</span>}
        <Chevron open={expanded} />
      </button>
      {expanded ? children : null}
    </div>
  );
}

export function RunningFigureIndicator() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <circle cx="14" cy="4" r="1.4" fill="currentColor" stroke="none" />
      <line x1="13.5" y1="5.5" x2="11" y2="12">
        <animate attributeName="y2" values="12;11.5;12;11.5;12" dur="0.6s" repeatCount="indefinite" />
      </line>

      <path strokeOpacity="0.4" d="M13 7 L10 9.5">
        <animate attributeName="d"
          values="M13 7 L10 9.5;M13 7 L15.5 9;M13 7 L16 10.5;M13 7 L15.5 9;M13 7 L10 9.5"
          dur="0.6s" repeatCount="indefinite" />
      </path>

      <path d="M13 7 L16 10.5">
        <animate attributeName="d"
          values="M13 7 L16 10.5;M13 7 L11.5 10;M13 7 L10 9.5;M13 7 L11.5 10;M13 7 L16 10.5"
          dur="0.6s" repeatCount="indefinite" />
      </path>

      <path strokeOpacity="0.4" d="M11 12 L8 15 L6.5 16">
        <animate attributeName="d"
          values="M11 12 L8 15 L6.5 16;M11 12 L12 16 L14 19;M11 12 L14.5 15.5 L16.5 18;M11 12 L12 16 L14 19;M11 12 L8 15 L6.5 16"
          dur="0.6s" repeatCount="indefinite" />
      </path>

      <path d="M11 12 L14.5 15.5 L16.5 18">
        <animate attributeName="d"
          values="M11 12 L14.5 15.5 L16.5 18;M11 12 L12 16 L10 19;M11 12 L8 15 L6.5 16;M11 12 L12 16 L10 19;M11 12 L14.5 15.5 L16.5 18"
          dur="0.6s" repeatCount="indefinite" />
      </path>

      <g strokeOpacity="0.25" strokeWidth="1.2">
        <line x1="6" y1="7" x2="3" y2="7.5">
          <animate attributeName="x1" values="6;4;6" dur="0.3s" repeatCount="indefinite" />
          <animate attributeName="x2" values="3;1;3" dur="0.3s" repeatCount="indefinite" />
        </line>
        <line x1="5" y1="10" x2="2.5" y2="10.5">
          <animate attributeName="x1" values="5;3;5" dur="0.3s" repeatCount="indefinite" />
          <animate attributeName="x2" values="2.5;0.5;2.5" dur="0.3s" repeatCount="indefinite" />
        </line>
      </g>
    </svg>
  );
}
