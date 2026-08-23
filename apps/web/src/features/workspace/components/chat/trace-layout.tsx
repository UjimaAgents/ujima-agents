import type { CSSProperties, ReactNode } from "react";
import {
  BookOpen,
  Brain,
  Clock,
  FileText,
  GitBranch,
  HelpCircle,
  MessageSquare,
  Pencil,
  Search,
  Settings2,
  Target,
  Terminal,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { AggregatedOperation } from "./trace-types";

const TOOL_ICONS: Record<AggregatedOperation["type"], LucideIcon> = {
  edit: Pencil,
  delete: Trash2,
  read: FileText,
  search: Search,
  shell: Terminal,
  tool: Wrench,
  skill: BookOpen,
  memory: Brain,
  goal: Target,
  question: HelpCircle,
  procedure: Settings2,
  schedule: Clock,
  message: MessageSquare,
  delegate: GitBranch,
};

const TRACE_RAIL_SIZE = "1.25rem";
const TRACE_RAIL_GAP = "0.5rem";
export const TRACE_ITEM_GAP = "0.875rem";

export const TRACE_ROW_STYLE = {
  display: "grid",
  gridTemplateColumns: `${TRACE_RAIL_SIZE} minmax(0, 1fr)`,
  columnGap: TRACE_RAIL_GAP,
  alignItems: "start",
  position: "relative",
  zIndex: 1,
} satisfies CSSProperties;

/** The operation list spans back into its parent step's rail column. */
export const TRACE_OPERATION_LIST_CLASS =
  "relative animate-in fade-in slide-in-from-top-1 duration-200";

export const TRACE_OPERATION_LIST_STYLE = {
  display: "flex",
  flexDirection: "column",
  rowGap: TRACE_ITEM_GAP,
  marginInlineStart: `calc(-${TRACE_RAIL_SIZE} - ${TRACE_RAIL_GAP})`,
  marginTop: TRACE_ITEM_GAP,
} satisfies CSSProperties;

const TRACE_MARKER_CLASS =
  "relative z-[1] flex shrink-0 items-center justify-center rounded-sm bg-background text-foreground/45";
const TRACE_ICON_CLASS = "h-3.5 w-3.5 shrink-0";
const TRACE_MARKER_STYLE = {
  position: "relative",
  width: TRACE_RAIL_SIZE,
  height: TRACE_RAIL_SIZE,
  zIndex: 2,
  backgroundColor: "var(--background)",
  boxShadow: "0 0 0 2px var(--background)",
} satisfies CSSProperties;

export function ToolCallIcon({
  type,
  className = TRACE_ICON_CLASS,
}: {
  type: AggregatedOperation["type"];
  className?: string;
}) {
  const Icon = TOOL_ICONS[type] ?? Wrench;
  return (
    <Icon
      className={className}
      strokeWidth={1.8}
      aria-hidden="true"
    />
  );
}

export function TraceMarker({
  type,
  className = "",
}: {
  type: AggregatedOperation["type"];
  className?: string;
}) {
  return (
    <span
      className={`${TRACE_MARKER_CLASS} ${className}`}
      style={TRACE_MARKER_STYLE}
    >
      <ToolCallIcon type={type} />
    </span>
  );
}

export function TraceRow({
  marker,
  className = "",
  children,
}: {
  marker: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`min-w-0 ${className}`} style={TRACE_ROW_STYLE}>
      <div
        className="flex shrink-0 items-center justify-center"
        style={TRACE_MARKER_STYLE}
      >
        {marker}
      </div>
      <div className="min-w-0" style={{ minHeight: TRACE_RAIL_SIZE }}>
        {children}
      </div>
    </div>
  );
}

export function TraceConnector({ className = "" }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none absolute bottom-0 w-px bg-zinc-300 dark:bg-zinc-700 ${className}`}
      style={{ top: TRACE_RAIL_SIZE, left: `calc(${TRACE_RAIL_SIZE} / 2)`, zIndex: 0 }}
      aria-hidden="true"
    />
  );
}
