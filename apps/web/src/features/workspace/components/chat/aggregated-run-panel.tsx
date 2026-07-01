import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Search, Terminal, Brain, Target, HelpCircle, BookOpen, Clock, MessageSquare } from "lucide-react";
import type { AggregatedOperation } from "./trace-types";
import { Markdown } from "../markdown";
import { TERMINAL_PANEL } from "./terminal-chrome";
import { TerminalPane } from "./terminal-pane";
import { SkillReadPane } from "./skill-read-pane";
import { UnifiedDiffView } from "./unified-diff-view";
function PathBreadcrumb({ path, className = "" }: { path: string; className?: string }) {
  if (!path) return null;
  const cleaned = path.replace(/.*\/Work\/[^/]+\//, "").replace(/^\.\//, "");
  const index = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
  if (index >= 0) {
    const prefix = cleaned.slice(0, index + 1);
    const file = cleaned.slice(index + 1);
    return (
      <span
        className={`group/path inline-flex items-center cursor-help min-w-0 ${className}`}
        title={path}
      >
        <span className="opacity-0 max-w-0 inline-block overflow-hidden transition-all duration-300 ease-out group-hover/path:opacity-100 group-hover/path:max-w-[24rem] group-hover/path:mr-1 font-normal select-none whitespace-nowrap text-xs text-foreground/70">
          {prefix}
        </span>
        <span className="font-semibold text-foreground/80 group-hover/path:text-foreground">{file}</span>
      </span>
    );
  }
  return <span className={`font-semibold text-foreground/80 ${className}`}>{cleaned}</span>;
}

const Chevron = ({ open }: { open: boolean }) =>
  open ? (
    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground/45" />
  ) : (
    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground/45" />
  );

function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="shrink-0 flex items-center gap-1.5 font-medium tabular-nums text-[11px]">
      <span className="text-emerald-600 dark:text-emerald-450 font-semibold">+{additions}</span>{" "}
      <span className="text-red-500 dark:text-red-400 font-semibold">-{deletions}</span>
    </span>
  );
}

function DiffBody({ op }: { op: AggregatedOperation }) {
  if (!op.body) return null;
  return (
    <div className={`mt-1.5 overflow-hidden ${TERMINAL_PANEL}`}>
      <div className="max-h-60 overflow-y-auto p-2.5 select-text">
        <UnifiedDiffView text={op.body} />
      </div>
    </div>
  );
}

interface DetailItem {
  key: string;
  val: string;
}

interface DetailSection {
  title?: string;
  type: "key-value" | "text" | "list";
  items?: DetailItem[];
  listItems?: string[];
  content?: string;
}

function parseDetail(detail: string): DetailSection[] {
  const sections: DetailSection[] = [];
  const parts = detail.split(/\n\n+/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Check if the part starts with a header line (e.g. "Arguments:", "Result:", "Recalled:")
    const lines = trimmed.split("\n");
    const firstLine = lines[0].trim();

    if (firstLine.endsWith(":") && lines.length > 1) {
      const title = firstLine.slice(0, -1).trim();
      const restLines = lines.slice(1);
      const restText = restLines.join("\n").trim();

      // Check if all lines in restLines are bullet items
      const isList = restLines.every((line) => line.trim().startsWith("-"));

      // Check if all lines in restLines look like Key: Value
      const isKeyValue = restLines.every((line) => {
        const colonIdx = line.indexOf(":");
        if (colonIdx <= 0) return false;
        const key = line.slice(0, colonIdx).trim();
        return key.length > 0 && key.length < 40 && !key.includes("\n");
      });

      if (isKeyValue) {
        const items = restLines.map((line) => {
          const colonIdx = line.indexOf(":");
          return {
            key: line.slice(0, colonIdx).trim(),
            val: line.slice(colonIdx + 1).trim(),
          };
        });
        sections.push({ title, type: "key-value", items });
      } else if (isList) {
        const listItems = restLines.map((line) => line.trim().replace(/^-\s*/, ""));
        sections.push({ title, type: "list", listItems });
      } else {
        sections.push({ title, type: "text", content: restText });
      }
    } else {
      // No explicit header, check if the entire part is a list or key-value list
      const isList = lines.every((line) => line.trim().startsWith("-"));
      const isKeyValue = lines.every((line) => {
        const colonIdx = line.indexOf(":");
        if (colonIdx <= 0) return false;
        const key = line.slice(0, colonIdx).trim();
        return key.length > 0 && key.length < 40 && !key.includes("\n");
      });

      if (isKeyValue) {
        const items = lines.map((line) => {
          const colonIdx = line.indexOf(":");
          return {
            key: line.slice(0, colonIdx).trim(),
            val: line.slice(colonIdx + 1).trim(),
          };
        });
        sections.push({ type: "key-value", items });
      } else if (isList) {
        const listItems = lines.map((line) => line.trim().replace(/^-\s*/, ""));
        sections.push({ type: "list", listItems });
      } else {
        // Maybe it's a single key-value line like "Forgot memory: some_key" or "Query: some_query"
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx > 0 && colonIdx < 40 && !trimmed.slice(0, colonIdx).includes("\n")) {
          const key = trimmed.slice(0, colonIdx).trim();
          const val = trimmed.slice(colonIdx + 1).trim();
          sections.push({
            type: "key-value",
            items: [{ key, val }],
          });
        } else {
          sections.push({ type: "text", content: trimmed });
        }
      }
    }
  }

  return sections;
}

function ToolHeader({ op, label }: { op: AggregatedOperation; label?: string }) {
  const sections = useMemo(() => parseDetail(op.detail ?? ""), [op.detail]);
  const { headerText } = useMemo(() => getToolHeaderAndCleanDetail(op, sections), [op, sections]);

  return (
    <span className="truncate font-semibold text-xs text-foreground/85 leading-none">
      {label ? label : headerText}
    </span>
  );
}

function getToolHeaderAndCleanDetail(op: AggregatedOperation, sections: DetailSection[]) {
  const toolName = op.toolName ?? op.type ?? "tool";
  const lowerName = toolName.toLowerCase();

  let target: string | undefined = undefined;
  let filteredSections = JSON.parse(JSON.stringify(sections)) as DetailSection[];

  // Find target and status in key-value items
  for (let sIdx = 0; sIdx < filteredSections.length; sIdx++) {
    const sec = filteredSections[sIdx];
    if (sec.type === "key-value" && sec.items) {
      const targetKeys = ["task", "key", "procedure", "query", "name", "prompt", "message", "command", "commandline", "cmd"];
      const matchIdx = sec.items.findIndex((item: DetailItem) => targetKeys.includes(item.key.toLowerCase()));
      if (matchIdx >= 0) {
        target = sec.items[matchIdx].val;
        // Strip the target key-value from the body so it isn't repeated!
        sec.items.splice(matchIdx, 1);
      }

      const statusIdx = sec.items.findIndex((item: DetailItem) => item.key.toLowerCase() === "status");
      if (statusIdx >= 0) {
        // Strip the status key-value from the body as well!
        sec.items.splice(statusIdx, 1);
      }
    }
  }

  // Remove empty key-value sections
  filteredSections = filteredSections.filter((sec: DetailSection) => {
    if (sec.type === "key-value" && sec.items && sec.items.length === 0) {
      return false;
    }
    return true;
  });

  // Build the clean verb label
  let verb = "Executed";
  if (op.type === "shell" || lowerName === "shell" || lowerName === "execute") {
    verb = target ? `Run "${target}"` : "Run terminal";
  } else if (op.type === "memory" || lowerName.startsWith("memory.")) {
    const isWrite = lowerName.includes("write");
    const isForget = lowerName.includes("forget");
    if (isWrite) {
      verb = target ? `Saved "${target}"` : "Saved";
    } else if (isForget) {
      verb = target ? `Forgot "${target}"` : "Forgot";
    } else {
      verb = target ? `Recalled "${target}"` : "Recalled";
    }
  } else if (op.type === "goal" || lowerName.startsWith("goal.")) {
    const isStart = lowerName.includes("start");
    if (isStart) {
      verb = target ? `Started "${target}"` : "Started";
    } else {
      verb = target ? `Updated "${target}"` : "Updated task";
    }
  } else if (op.type === "question" || lowerName.startsWith("question.")) {
    verb = target ? `Asked "${target}"` : "Asked";
  } else if (op.type === "procedure" || lowerName.includes("procedure")) {
    const act = lowerName.includes("add")
      ? "Added"
      : lowerName.includes("remove")
        ? "Removed"
        : lowerName.includes("view")
          ? "Viewed"
          : "Updated";
    verb = target ? `${act} "${target}"` : act;
  } else if (op.type === "schedule" || lowerName === "schedule") {
    verb = target ? `Updated "${target}"` : "Updated";
  } else if (op.type === "delegate" || lowerName === "agent.delegate") {
    verb = target ? `Delegated "${target}"` : "Delegated";
  } else if (op.type === "skill" || lowerName === "skill.read") {
    verb = op.skillRead?.skillName ? `Read "${op.skillRead.skillName}"` : "Read skill";
  } else if (op.type === "message" || lowerName.startsWith("channel.") || lowerName === "message") {
    verb = lowerName.includes("reply")
      ? "Replied"
      : lowerName.includes("dm")
        ? "Direct Message"
        : "Sent";
    if (target) {
      verb = `${verb} "${target}"`;
    }
  } else {
    const parts = toolName.split(".");
    const baseName = parts[parts.length - 1];
    const cleanBase = baseName.charAt(0).toUpperCase() + baseName.slice(1).toLowerCase();
    verb = target ? `${cleanBase} "${target}"` : `Called ${baseName}`;
  }

  // Clean up any tautological labels passed dynamically
  let displayLabel = verb;
  if (displayLabel) {
    const badge = op.type ? op.type.charAt(0).toUpperCase() + op.type.slice(1).toLowerCase() : "Tool";
    const regex = new RegExp(`\\b${badge}\\b|\\b${badge}s\\b`, "gi");
    displayLabel = displayLabel.replace(regex, "").trim();
    
    // Truncate long target values in header
    displayLabel = displayLabel.replace(/"([^"]{40,})"/g, (match, p1) => `"${p1.slice(0, 40)}..."`);
    
    if (displayLabel) {
      displayLabel = displayLabel.charAt(0).toUpperCase() + displayLabel.slice(1);
    } else {
      displayLabel = "Executed";
    }
  }

  return {
    headerText: displayLabel,
    filteredSections,
  };
}

function PrettyToolDetailDetail({ op }: { op: AggregatedOperation }) {
  const sections = useMemo(() => parseDetail(op.detail ?? ""), [op.detail]);
  const { filteredSections } = useMemo(() => getToolHeaderAndCleanDetail(op, sections), [op, sections]);

  return <PrettyToolDetail sections={filteredSections} />;
}

function ToolTrailing({ op }: { op: AggregatedOperation }) {
  const sections = useMemo(() => parseDetail(op.detail ?? ""), [op.detail]);
  
  let statusVal: string | undefined = undefined;
  for (const sec of sections) {
    if (sec.type === "key-value" && sec.items) {
      const match = sec.items.find((item: DetailItem) => item.key.toLowerCase() === "status");
      if (match) {
        statusVal = match.val;
        break;
      }
    }
  }

  if (!statusVal) return null;
  return renderValue("status", statusVal);
}

function renderSingleStatusBadge(statusStr: string) {
  const lowerVal = statusStr.toLowerCase();
  let badgeClass = "bg-foreground/10 text-foreground/60";
  if (lowerVal === "completed" || lowerVal === "success" || lowerVal === "done" || lowerVal === "ok") {
    badgeClass = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  } else if (lowerVal === "in_progress" || lowerVal === "running" || lowerVal === "started") {
    badgeClass = "bg-violet-500/10 text-violet-600 dark:text-violet-400";
  } else if (lowerVal === "failed" || lowerVal === "error" || lowerVal === "cancelled") {
    badgeClass = "bg-red-500/10 text-red-600 dark:text-red-400";
  } else if (lowerVal === "pending") {
    badgeClass = "bg-amber-500/10 text-amber-600 dark:text-amber-400";
  }

  const formattedLabel = statusStr
    .replace(/[_-]/g, " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.25 text-[9px] font-semibold font-mono tracking-wide ${badgeClass}`}>
      {formattedLabel}
    </span>
  );
}

function renderValue(key: string, val: string) {
  const valTrimmed = val.trim();
  const lowerVal = valTrimmed.toLowerCase();
  const lowerKey = key.toLowerCase();

  // Boolean badges
  if (lowerVal === "true" || lowerVal === "false") {
    return (
      <span className={`inline-flex items-center rounded px-1.5 py-0.25 text-[9px] font-semibold font-mono tracking-wide ${lowerVal === "true" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-foreground/10 text-foreground/60"}`}>
        {valTrimmed}
      </span>
    );
  }

  // Status/state badges
  if (
    lowerKey.includes("status") ||
    lowerKey.includes("state") ||
    lowerVal === "in_progress" ||
    lowerVal === "completed" ||
    lowerVal === "failed" ||
    lowerVal === "success" ||
    lowerVal === "running" ||
    lowerVal === "pending" ||
    valTrimmed.includes("->")
  ) {
    if (valTrimmed.includes("->")) {
      const parts = valTrimmed.split("->").map((p) => p.trim());
      if (parts.length === 2 && parts[0] && parts[1]) {
        return (
          <span className="inline-flex items-center gap-1.5 font-mono text-[9px]">
            {renderSingleStatusBadge(parts[0])}
            <span className="text-foreground/35 font-sans font-medium">→</span>
            {renderSingleStatusBadge(parts[1])}
          </span>
        );
      }
    }
    return renderSingleStatusBadge(valTrimmed);
  }

  return (
    <code className="font-mono text-[10px] text-violet-750 dark:text-violet-300 bg-violet-500/[0.04] dark:bg-white/5 px-1.5 py-0.5 rounded">
      {valTrimmed}
    </code>
  );
}

export function TraceMarkdown({ content, tone = "text-foreground/70" }: { content: string; tone?: string }) {
  return <Markdown content={content} className={`trace-step-text ${tone}`} />;
}

export function PrettyToolDetail({
  detail,
  sections: passedSections,
}: {
  detail?: string;
  sections?: DetailSection[];
}) {
  const parsed = useMemo(() => parseDetail(detail ?? ""), [detail]);
  const sections = passedSections ?? parsed;

  if (sections.length === 0) return null;

  return (
    <div className="mt-2 space-y-3 pl-1 select-text">
      {sections.map((section, idx) => {
        const title = section.title;

        const header = title && !["arguments", "result", "recalled", "input", "output"].includes(title.toLowerCase()) ? (
          <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-foreground/40 select-none">
            {title}
          </div>
        ) : null;

        // Render key-value pairs
        if (section.type === "key-value" && section.items) {
          return (
            <div key={idx} className="space-y-1.5">
              {header}
              <div className="flex flex-wrap items-center gap-1.5 pl-2">
                {section.items.map((item: DetailItem, itemIdx: number) => {
                  const valTrimmed = item.val.trim();
                  const isLong = valTrimmed.length > 50 || valTrimmed.includes("\n");
                  
                  if (isLong) {
                    return (
                      <div key={itemIdx} className="w-full space-y-1 py-0.5">
                        <div className="font-mono text-[10px] leading-relaxed text-foreground/80 bg-violet-500/[0.02] dark:bg-white/[0.015] border border-violet-500/[0.06] dark:border-white/[0.06] shadow-sm rounded-md p-2 max-h-40 overflow-y-auto whitespace-pre-wrap select-text">
                          {valTrimmed}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={itemIdx} className="text-[11px] py-0.5">
                      {renderValue(item.key, item.val)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        // Render lists
        if (section.type === "list" && section.listItems) {
          return (
            <div key={idx} className="space-y-1.5">
              {header}
              <ul className="space-y-1.5 pl-2">
                {section.listItems.map((item: string, itemIdx: number) => (
                  <li key={itemIdx} className="flex gap-2 text-[11px] leading-relaxed text-foreground/75 select-text">
                    <span className="text-violet-500/50 select-none">•</span>
                    <div className="flex-1 whitespace-pre-wrap font-mono">
                      <TraceMarkdown content={item} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        }

        // Render plain text
        if (section.type === "text" && section.content) {
          return (
            <div key={idx} className="space-y-1.5">
              {header}
              <div className="pl-2 select-text">
                <TraceMarkdown content={section.content} tone="text-foreground/75" />
              </div>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

const ROW_BUTTON_CLASS =
  "flex w-full flex-wrap items-center gap-2 text-xs text-foreground/70 hover:text-foreground/90 text-left transition-colors";

function ExpandableRow({
  expanded,
  onToggle,
  header,
  trailing,
  children,
}: {
  expanded: boolean;
  onToggle: (e: React.MouseEvent) => void;
  header: React.ReactNode;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="py-1 pl-2 animate-in fade-in duration-200">
      <button onClick={onToggle} className={ROW_BUTTON_CLASS}>
        <span className="flex-1 min-w-0 truncate text-left">{header}</span>
        {trailing && <span className="shrink-0 ml-auto mr-1.5">{trailing}</span>}
        <Chevron open={expanded} />
      </button>
      {expanded ? children : null}
    </div>
  );
}

export function AggregatedRunPanel({
  operations,
  autoOpen = false,
}: {
  operations: AggregatedOperation[];
  autoOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState<boolean | undefined>();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const panelOpen = isOpen ?? autoOpen;

  const counts = operations.reduce<Record<AggregatedOperation["type"], number>>(
    (acc, op) => ({ ...acc, [op.type]: (acc[op.type] ?? 0) + 1 }),
    { edit: 0, delete: 0, read: 0, search: 0, shell: 0, tool: 0, skill: 0, memory: 0, goal: 0, question: 0, procedure: 0, schedule: 0, message: 0, delegate: 0 },
  );
  const diffTotals = operations.reduce(
    (acc, op) => ({
      additions: acc.additions + op.additions,
      deletions: acc.deletions + op.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
  const summaryParts = [
    counts.edit && `Edited ${counts.edit} ${plural(counts.edit, "file")}`,
    counts.delete && `deleted ${counts.delete} ${plural(counts.delete, "file")}`,
    counts.read && `explored ${counts.read} ${plural(counts.read, "file")}`,
    counts.search && `${counts.search} ${plural(counts.search, "search", "searches")}`,
    counts.shell && `run terminal ${counts.shell} ${plural(counts.shell, "time")}`,
    counts.skill && `read ${counts.skill} ${plural(counts.skill, "skill")}`,
    counts.memory && `used memory ${counts.memory} ${plural(counts.memory, "time")}`,
    counts.goal && `updated goals ${counts.goal} ${plural(counts.goal, "time")}`,
    counts.question && `asked ${counts.question} ${plural(counts.question, "question")}`,
    counts.procedure && `updated procedures ${counts.procedure} ${plural(counts.procedure, "time")}`,
    counts.schedule && `updated schedules ${counts.schedule} ${plural(counts.schedule, "time")}`,
    counts.message && `sent ${counts.message} ${plural(counts.message, "message")}`,
    counts.tool && `called ${counts.tool} ${plural(counts.tool, "tool")}`,
  ].filter(Boolean);
  const summaryText = summaryParts.join(", ");

  const toggle = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const Icon =
    counts.edit + counts.delete > 0
      ? Pencil
      : counts.goal > 0
        ? Target
      : counts.question > 0
        ? HelpCircle
        : counts.skill + counts.procedure > 0
          ? BookOpen
            : counts.schedule > 0
              ? Clock
              : counts.message > 0
                ? MessageSquare
                : counts.memory > 0
                  ? Brain
                  : counts.search > 0 && counts.shell === 0
                    ? Search
                    : Terminal;

  return (
    <div className="w-full">
      <button
        onClick={() => setIsOpen(!panelOpen)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] px-3 py-2 text-left text-xs font-medium text-foreground/75 shadow-sm transition-all hover:bg-foreground/[0.04] active:bg-foreground/[0.06]"
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {Icon !== Terminal ? (
            <Icon className="h-3.5 w-3.5 shrink-0 self-center translate-y-px text-foreground/50" />
          ) : null}
          <span className="min-w-0 flex-1 whitespace-normal break-words leading-5">
            {summaryText || "Executed tool actions"}
          </span>
          {counts.edit + counts.delete > 0 && !panelOpen ? (
            <span className="shrink-0">
              <DiffStat additions={diffTotals.additions} deletions={diffTotals.deletions} />
            </span>
          ) : null}
        </span>
        <Chevron open={panelOpen} />
      </button>

      {panelOpen && operations.length > 0 && (
        <div className="mt-2 pl-2 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
          {operations.map((op, index) => {
            const autoExpandOperation = autoOpen && (op.status === "running" || index === operations.length - 1);
            const isExpanded = expanded[op.id] ?? autoExpandOperation;

            if (op.type === "edit" || op.type === "delete") {
              const verb = op.type === "edit" ? "Edited" : "Deleted";
              return (
                <ExpandableRow
                  key={op.id}
                  expanded={isExpanded}
                  onToggle={toggle(op.id)}
                  header={
                    <span className="break-words flex items-center gap-1 min-w-0 max-w-[calc(100%-6rem)]">
                      <span className="shrink-0">{verb}</span>
                      <PathBreadcrumb path={op.file ?? ""} className="min-w-0 truncate" />
                    </span>
                  }
                  trailing={!isExpanded ? <DiffStat additions={op.additions} deletions={op.deletions} /> : null}
                >
                  <DiffBody op={op} />
                </ExpandableRow>
              );
            }

            if (op.type === "read") {
              return (
                <div key={op.id} className="py-1 text-xs text-foreground/60 pl-2 truncate flex items-center gap-1">
                  <span className="shrink-0">Read</span>
                  <PathBreadcrumb path={op.file ?? ""} className="min-w-0 truncate" />
                  {op.lines ? <span className="inline-block ml-1 text-foreground/40 font-medium shrink-0">(lines {op.lines})</span> : null}
                </div>
              );
            }

            if (op.type === "search") {
              return (
                <div key={op.id} className="py-1 text-xs text-foreground/70 pl-2 truncate flex items-center gap-1">
                  <span className="shrink-0">Searched for</span>
                  <span className="font-mono text-[11px] text-foreground/80 truncate max-w-[8rem]">&ldquo;{op.query}&rdquo;</span>
                  {op.file ? (
                    <>
                      <span className="shrink-0">in</span>
                      <PathBreadcrumb path={op.file} className="min-w-0 truncate" />
                    </>
                  ) : null}
                </div>
              );
            }

            if (op.type === "shell") {
              return (
                <ExpandableRow
                  key={op.id}
                  expanded={isExpanded}
                  onToggle={toggle(op.id)}
                  header={<ToolHeader op={op} />}
                  trailing={<ToolTrailing op={op} />}
                >
                  {op.terminal ? (
                    <TerminalPane
                      className="mt-1.5"
                      cwd={op.terminal.cwd}
                      commandLine={op.terminal.commandLine}
                      output={op.terminal.output}
                      outputPlaceholder={op.terminal.outputPlaceholder}
                      outputTone={op.terminal.outputTone}
                    />
                  ) : null}
                </ExpandableRow>
              );
            }

            if (op.type === "skill" && op.skillRead) {
              return (
                <div key={op.id} className="pl-0">
                  <SkillReadPane
                    skillName={op.skillRead.skillName}
                    pluginName={op.skillRead.pluginName}
                    description={op.skillRead.description}
                    output={op.skillRead.output}
                    status={op.status}
                  />
                </div>
              );
            }

            if (op.type === "memory" || op.type === "goal" || op.type === "question" || op.type === "procedure" || op.type === "schedule" || op.type === "delegate" || op.type === "message" || op.type === "tool") {
              return (
                <ExpandableRow
                  key={op.id}
                  expanded={isExpanded}
                  onToggle={toggle(op.id)}
                  header={<ToolHeader op={op} />}
                  trailing={<ToolTrailing op={op} />}
                >
                  <PrettyToolDetailDetail op={op} />
                </ExpandableRow>
              );
            }

            return null;
          })}
        </div>
      )}
    </div>
  );
}

