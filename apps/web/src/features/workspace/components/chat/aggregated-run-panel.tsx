import { useMemo, useState } from "react";
import type { AggregatedOperation } from "./trace-types";
import { Markdown } from "../markdown";
import { TERMINAL_PANEL } from "./terminal-chrome";
import { TerminalPane } from "./terminal-pane";
import { SkillReadPane } from "./skill-read-pane";
import { UnifiedDiffView } from "./unified-diff-view";
import { Chevron, ExpandableRow } from "./primitives";
import {
  TRACE_OPERATION_LIST_CLASS,
  TRACE_OPERATION_LIST_STYLE,
  TraceMarker,
  TraceRow,
} from "./trace-layout";

function OperationTrailItem({
  type,
  className = "",
  children,
}: {
  type: AggregatedOperation["type"];
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TraceRow
      marker={<TraceMarker type={type} />}
      className={className}
    >
      {children}
    </TraceRow>
  );
}

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
    <span className="truncate font-semibold text-xs leading-snug text-foreground/85">
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
  for (const sec of filteredSections) {
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
    target = op.command?.trim() || target;
    verb = target ? `Ran "${target}"` : "Ran terminal";
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

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isUuidLike(value: string | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function cleanMessageMeta(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || isUuidLike(trimmed)) return undefined;
  return trimmed;
}

function normalizeToolInput(op: AggregatedOperation): Record<string, unknown> | undefined {
  const input = recordValue(op.toolInput);
  const nested = recordValue(input?.input);
  return nested ?? input;
}

function DelegateToolPane({
  op,
  expanded,
  onToggle,
}: {
  op: AggregatedOperation;
  expanded: boolean;
  onToggle: (event: React.MouseEvent) => void;
}) {
  const input = normalizeToolInput(op) ?? {};
  const rawResult = recordValue(op.toolResult) ?? {};
  const result = recordValue(rawResult.result) ?? rawResult;
  const action = stringValue(input.action) ?? "start";
  const inputItems = Array.isArray(input.tasks)
    ? input.tasks.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item))
    : Array.isArray(input.delegates)
      ? input.delegates.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item))
      : [input];
  const resultItems = Array.isArray(result.details)
    ? result.details.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item))
    : Array.isArray(result.results)
      ? result.results.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item))
      : Object.keys(result).length > 0 ? [result] : [];
  const itemCount = Math.max(inputItems.length, resultItems.length, 1);
  const items = Array.from({ length: itemCount }, (_, index) => {
    const task = inputItems[index] ?? inputItems[0] ?? {};
    const outcome = resultItems.find((item) => item.delegate_index === index) ?? resultItems[index] ?? {};
    return {
      target: stringValue(task.target) ?? stringValue(task.to) ?? stringValue(outcome.agent),
      task: stringValue(task.task) ?? stringValue(task.message),
      mode: stringValue(task.mode) ?? stringValue(task.kind),
      status: stringValue(outcome.status),
      reply: stringValue(outcome.reply_content),
    };
  });
  const singleTarget = itemCount === 1 ? items[0]?.target : undefined;
  const title = action === "start" || action === "spawn" || action === "start_many"
    ? singleTarget ? `Delegated to ${singleTarget}` : `Delegated ${itemCount} tasks`
    : action === "status" ? "Checked delegation status"
      : action === "join" || action === "wait" ? "Waited for delegated work"
        : action === "read" ? "Read delegated work"
          : action === "stop" ? "Stopped delegated work"
            : action === "send" ? "Messaged delegate"
              : "Updated delegated work";
  const status = stringValue(result.status) ?? (op.status === "success" ? "completed" : op.status);

  return (
    <ExpandableRow
      expanded={expanded}
      onToggle={onToggle}
      header={<span className="trace-step-text truncate font-semibold leading-snug text-foreground/85">{title}</span>}
      trailing={renderSingleStatusBadge(status)}
    >
      <div className="trace-step-text mt-2 space-y-2 leading-relaxed text-foreground/70">
        {items.map((item, index) => (
          <div key={`${op.id}:delegate:${index}`} className="min-w-0 pl-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold text-foreground/80">
                {item.target ?? `Task ${index + 1}`}
              </span>
              {item.mode ? <span className="shrink-0 text-[10px] uppercase tracking-wide text-foreground/40">{item.mode}</span> : null}
              {item.status ? <span className="ml-auto shrink-0">{renderSingleStatusBadge(item.status)}</span> : null}
            </div>
            {item.task ? <p className="mt-1 whitespace-pre-wrap text-foreground/65">{item.task}</p> : null}
            {item.reply ? <p className="mt-1 whitespace-pre-wrap text-foreground/50">{item.reply}</p> : null}
          </div>
        ))}
        {items.every((item) => !item.task && !item.reply) && op.detail ? (
          <PrettyToolDetailDetail op={op} />
        ) : null}
      </div>
    </ExpandableRow>
  );
}

function GoalToolPane({
  op,
  expanded,
  onToggle,
}: {
  op: AggregatedOperation;
  expanded: boolean;
  onToggle: (event: React.MouseEvent) => void;
}) {
  const input = normalizeToolInput(op) ?? {};
  const rawResult = recordValue(op.toolResult) ?? {};
  const result = recordValue(rawResult.result) ?? rawResult;
  const goal = recordValue(result.goal) ?? {};
  const action = stringValue(input.action);
  const title = stringValue(input.title) ?? stringValue(goal.title);
  const taskRecords = Array.isArray(input.tasks)
    ? input.tasks.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item))
    : Array.isArray(result.tasks)
      ? result.tasks.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item))
      : [];
  const plan = stringValue(input.plan_markdown) ?? stringValue(input.description) ?? stringValue(goal.description);
  const header = op.toolName === "goal.start"
    ? title ? `Started ${title}` : "Started goal"
    : op.toolName === "goal.task.update"
      ? title ? `Updated ${title}` : "Updated goal task"
      : action === "create" ? title ? `Created goal · ${title}` : "Created goal"
        : action === "start" || action === "resume" ? title ? `Resumed goal · ${title}` : "Resumed goal"
          : action === "pause" ? title ? `Paused goal · ${title}` : "Paused goal"
            : action === "stop" ? title ? `Stopped goal · ${title}` : "Stopped goal"
              : title ? `Updated ${title}` : "Updated goal";
  const status = stringValue(goal.status) ?? stringValue(result.status) ?? (op.status === "success" ? undefined : op.status);

  return (
    <ExpandableRow
      expanded={expanded}
      onToggle={onToggle}
      header={<span className="trace-step-text truncate font-semibold leading-snug text-foreground/85">{header}</span>}
      trailing={status ? renderSingleStatusBadge(status) : null}
    >
      <div className="trace-step-text mt-2 space-y-2 leading-relaxed text-foreground/65">
        {plan ? (
          <p
            className="whitespace-pre-wrap"
            style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 4, overflow: "hidden" }}
          >
            {plan}
          </p>
        ) : null}
        {taskRecords.length > 0 ? (
          <div className="space-y-1.5">
            {taskRecords.map((task, index) => {
              const taskTitle = stringValue(task.title) ?? `Task ${index + 1}`;
              const assignee = stringValue(task.assignee_id) ?? stringValue(task.assigneeId);
              const taskStatus = stringValue(task.status);
              return (
                <div key={`${op.id}:goal-task:${index}`} className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-foreground/75">{taskTitle}</span>
                  {assignee ? <span className="shrink-0 text-[10px] text-foreground/40">{assignee}</span> : null}
                  {taskStatus ? <span className="ml-auto shrink-0">{renderSingleStatusBadge(taskStatus)}</span> : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {!plan && taskRecords.length === 0 && op.detail ? <PrettyToolDetailDetail op={op} /> : null}
      </div>
    </ExpandableRow>
  );
}

function QuestionToolPane({
  op,
  expanded,
  onToggle,
}: {
  op: AggregatedOperation;
  expanded: boolean;
  onToggle: (event: React.MouseEvent) => void;
}) {
  const input = normalizeToolInput(op) ?? {};
  const result = recordValue(op.toolResult);
  const question = stringValue(input.question_text) ?? stringValue(input.questionText) ?? "Asked a question";
  const options = Array.isArray(input.options)
    ? input.options.filter((option): option is string => typeof option === "string" && option.trim().length > 0)
    : [];
  const status = stringValue(result?.status) ?? (op.status === "success" ? undefined : op.status);

  return (
    <ExpandableRow
      expanded={expanded}
      onToggle={onToggle}
      header={<span className="trace-step-text truncate font-semibold leading-snug text-foreground/85">Asked</span>}
      trailing={status ? renderSingleStatusBadge(status) : null}
    >
      <div className="trace-step-text mt-2 space-y-2 leading-relaxed text-foreground/70">
        <p className="whitespace-pre-wrap font-medium text-foreground/80">{question}</p>
        {options.length > 0 ? (
          <ol className="space-y-1.5 pl-1">
            {options.map((option, index) => {
              const recommended = /\s*\(Recommended\)\s*$/i.test(option);
              const label = option.replace(/\s*\(Recommended\)\s*$/i, "");
              return (
                <li key={`${op.id}:question-option:${index}`} className="flex min-w-0 items-start gap-2 text-foreground/65">
                  <span className="shrink-0 tabular-nums text-foreground/35">{index + 1}.</span>
                  <span className="min-w-0 whitespace-pre-wrap">{label}</span>
                  {recommended ? <span className="shrink-0 text-[0.75em] font-semibold uppercase tracking-wide text-foreground/40">Recommended</span> : null}
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </ExpandableRow>
  );
}

function messageToolSummary(op: AggregatedOperation): string {
  const tool = op.toolName ?? "";
  if (tool === "channel.reply") return "replied";
  if (tool === "channel.dm") return "sent a direct message";
  if (tool === "channel.post") return "posted a message";
  if (tool === "channel.close") return "closed a thread";
  if (tool === "channel.pass") return "stood down";
  if (tool === "channel.ack") return "acknowledged";
  if (tool === "channel.handoff") return "handed off";
  return "completed a message action";
}

function MessageToolPane({
  op,
  expanded,
  onToggle,
}: {
  op: AggregatedOperation;
  expanded: boolean;
  onToggle: (event: React.MouseEvent) => void;
}) {
  const input = normalizeToolInput(op);
  const result = recordValue(op.toolResult);
  const tool = op.toolName ?? "";
  const title = semanticToolTitle(tool);
  const body =
    stringValue(input?.message) ??
    stringValue(input?.content) ??
    stringValue(input?.text) ??
    stringValue(input?.body) ??
    stringValue(input?.value) ??
    stringValue(input?.note) ??
    stringValue(input?.reason) ??
    stringValue(result?.message) ??
    stringValue(result?.error);
  const target =
    cleanMessageMeta(stringValue(input?.member_id)) ??
    cleanMessageMeta(stringValue(input?.channel_id)) ??
    cleanMessageMeta(stringValue(input?.message_id));
  const targetLabel =
    tool === "channel.dm"
      ? "Recipient"
      : tool === "channel.post"
        ? "Channel"
        : tool === "channel.reply"
          ? "Reply"
          : tool === "channel.close"
            ? "Reason"
            : "Target";

  return (
    <ExpandableRow
      expanded={expanded}
      onToggle={onToggle}
      header={<span className="trace-step-text truncate font-semibold leading-snug text-foreground/85">{title}</span>}
      trailing={op.status !== "success" ? renderSingleStatusBadge(op.status) : null}
    >
      <div className="trace-step-text mt-2 space-y-1 leading-relaxed text-foreground/70">
        {target ? <div className="text-foreground/45">{targetLabel}: {target}</div> : null}
        {body ? <p className="whitespace-pre-wrap text-foreground/70">{body}</p> : null}
      </div>
    </ExpandableRow>
  );
}

function memoryEntries(result: Record<string, unknown> | undefined): string[] {
  const entries = result?.entries;
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => {
      const record = recordValue(entry);
      return stringValue(record?.value) ?? stringValue(record?.content);
    })
    .filter((value): value is string => Boolean(value));
}

function MemoryToolPane({
  op,
  expanded,
  onToggle,
}: {
  op: AggregatedOperation;
  expanded: boolean;
  onToggle: (event: React.MouseEvent) => void;
}) {
  const input = normalizeToolInput(op);
  const result = recordValue(op.toolResult);
  const tool = op.toolName ?? "";
  const title = semanticToolTitle(tool);
  const query =
    stringValue(input?.query) ??
    stringValue(input?.key_prefix) ??
    stringValue(input?.key);
  const body =
    tool === "memory.recall"
      ? undefined
      : stringValue(input?.value) ??
        stringValue(input?.content) ??
        stringValue(input?.body) ??
        stringValue(result?.message) ??
        stringValue(result?.error);
  const recalled = tool === "memory.recall" ? memoryEntries(result) : [];
  const emptyRecall = tool === "memory.recall" && recalled.length === 0;

  return (
    <ExpandableRow
      expanded={expanded}
      onToggle={onToggle}
      header={<span className="trace-step-text truncate font-semibold leading-snug text-foreground/85">{title}</span>}
      trailing={op.status !== "success" ? renderSingleStatusBadge(op.status) : null}
    >
      <div className="trace-step-text mt-2 space-y-1 leading-relaxed text-foreground/70">
        {query ? <div className="text-foreground/45">{semanticTargetLabel(tool)}: {query}</div> : null}
        {body ? <p className="whitespace-pre-wrap text-foreground/70">{body}</p> : null}
        {recalled.length > 0 ? (
          <div className="space-y-1 text-foreground/65">
          {recalled.map((item, index) => (
            <div key={`${op.id}-memory-${index}`}>{item}</div>
          ))}
          </div>
        ) : null}
        {emptyRecall ? <div className="text-foreground/45">No matching memories found.</div> : null}
      </div>
    </ExpandableRow>
  );
}

export function SemanticToolPane({ op }: { op: AggregatedOperation }) {
  const input = normalizeToolInput(op);
  const result = recordValue(op.toolResult);
  const tool = op.toolName ?? "";
  const title = semanticToolTitle(tool);
  const target =
    stringValue(input?.key) ??
    stringValue(input?.query) ??
    stringValue(input?.member_id) ??
    stringValue(input?.message_id) ??
    stringValue(input?.reason) ??
    stringValue(input?.status);
  const body =
    stringValue(input?.body) ??
    stringValue(input?.value) ??
    stringValue(input?.content) ??
    stringValue(result?.message) ??
    stringValue(result?.error);
  const resultStatus = stringValue(result?.status);
  const meta = [
    target ? { key: semanticTargetLabel(tool), val: target } : null,
    resultStatus ? { key: "Status", val: resultStatus } : null,
  ].filter((item): item is DetailItem => Boolean(item));

  return (
    <div className="trace-step-text min-w-0 leading-relaxed">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-foreground/85">{title}</div>
          {target ? <div className="mt-0.5 truncate text-[11px] text-foreground/45">{target}</div> : null}
        </div>
        {op.status !== "success" ? renderSingleStatusBadge(op.status) : null}
      </div>
      {body ? <div className="mt-1 whitespace-pre-wrap text-foreground/70">{body}</div> : null}
      {meta.length > 0 ? <PrettyToolDetail sections={[{ type: "key-value", items: meta }]} /> : null}
    </div>
  );
}

function semanticTargetLabel(toolName: string): string {
  if (toolName === "channel.dm") return "Recipient";
  if (toolName === "channel.reply") return "Reply";
  if (toolName === "channel.close") return "Reason";
  if (toolName.startsWith("memory.")) return toolName === "memory.recall" ? "Query" : "Key";
  return "Target";
}

function semanticToolTitle(toolName: string): string {
  if (toolName === "channel.reply") return "Replied";
  if (toolName === "channel.dm") return "Sent DM";
  if (toolName === "channel.close") return "Closed";
  if (toolName === "channel.pass") return "Passed";
  if (toolName === "channel.ack") return "Acknowledged";
  if (toolName === "channel.handoff") return "Handed off";
  if (toolName === "channel.post") return "Posted";
  if (toolName === "memory.write") return "Wrote memory";
  if (toolName === "memory.recall") return "Recalled memory";
  if (toolName === "memory.forget") return "Forgot memory";
  return toolName || "Tool";
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


export function AggregatedRunPanel({
  operations,
  actorName,
  autoOpen = false,
}: {
  operations: AggregatedOperation[];
  actorName?: string;
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
    counts.edit && `edited ${counts.edit} ${plural(counts.edit, "file")}`,
    counts.delete && `deleted ${counts.delete} ${plural(counts.delete, "file")}`,
    counts.read && `explored ${counts.read} ${plural(counts.read, "file")}`,
    counts.search && `searched ${counts.search} ${plural(counts.search, "time")}`,
    counts.shell && `ran terminal ${counts.shell} ${plural(counts.shell, "time")}`,
    counts.skill && `read ${counts.skill} ${plural(counts.skill, "skill")}`,
    counts.memory && `used memory ${counts.memory} ${plural(counts.memory, "time")}`,
    counts.goal && `updated goals ${counts.goal} ${plural(counts.goal, "time")}`,
    counts.question && `asked ${counts.question} ${plural(counts.question, "question")}`,
    counts.procedure && `updated procedures ${counts.procedure} ${plural(counts.procedure, "time")}`,
    counts.schedule && `updated schedules ${counts.schedule} ${plural(counts.schedule, "time")}`,
    counts.message && `sent ${counts.message} ${plural(counts.message, "message action")}`,
    counts.tool && `called ${counts.tool} ${plural(counts.tool, "tool")}`,
  ].filter(Boolean);
  const summaryText =
    operations.length === 1 && operations[0]?.type === "message"
      ? messageToolSummary(operations[0])
      : summaryParts.join(", ");
  const displaySummary = summaryText || "completed tool actions";

  const toggle = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="w-full">
      <button
        onClick={() => setIsOpen(!panelOpen)}
        className="trace-step-text flex w-full cursor-pointer items-start justify-between gap-2 rounded-md p-0 text-left font-medium text-foreground/75 transition-colors hover:bg-foreground/[0.04] hover:text-foreground active:bg-foreground/[0.06] active:text-foreground/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/20"
      >
        <span className="flex min-w-0 flex-1 items-start">
          <span className="min-w-0 flex-1 whitespace-normal break-words leading-6">
            {actorName ? <span className="font-semibold text-foreground">{actorName}</span> : null}
            {actorName ? " " : null}
            <span className={actorName ? "font-normal text-foreground/75" : ""}>{displaySummary}</span>
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
        <div
          className={TRACE_OPERATION_LIST_CLASS}
          style={TRACE_OPERATION_LIST_STYLE}
        >
          {operations.map((op, index) => {
            const autoExpandOperation = autoOpen && (op.status === "running" || index === operations.length - 1);
            const isExpanded = expanded[op.id] ?? autoExpandOperation;
            if (op.type === "edit" || op.type === "delete") {
              const verb = op.type === "edit" ? "Edited" : "Deleted";
              return (
                  <OperationTrailItem key={op.id} type={op.type}>
                    <ExpandableRow
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
                  </OperationTrailItem>
                );
            }

            if (op.type === "read") {
              return (
                <OperationTrailItem key={op.id} type={op.type} className="trace-step-text leading-snug text-foreground/60">
                  <ExpandableRow
                    expanded={isExpanded}
                    onToggle={toggle(op.id)}
                    header={
                      <span className="flex min-w-0 items-center gap-1 truncate">
                        <span className="shrink-0">Read file</span>
                        <PathBreadcrumb path={op.file ?? ""} className="min-w-0 truncate" />
                        {op.lines ? <span className="ml-1 shrink-0 font-medium text-foreground/40">(lines {op.lines})</span> : null}
                      </span>
                    }
                  >
                    {op.body ? (
                      <pre className="trace-step-text-sm mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words pl-1 font-mono leading-relaxed text-foreground/70">
                        {op.body}
                      </pre>
                    ) : null}
                  </ExpandableRow>
                </OperationTrailItem>
              );
            }

            if (op.type === "search") {
              return (
                <OperationTrailItem key={op.id} type={op.type} className="trace-step-text leading-snug text-foreground/70">
                  <div className="flex min-h-5 min-w-0 items-center gap-1 truncate">
                    <span className="shrink-0">Searched for</span>
                    <span className="max-w-[8rem] truncate font-mono text-xs text-foreground/80">&ldquo;{op.query}&rdquo;</span>
                    {op.file ? (
                      <>
                        <span className="shrink-0">in</span>
                        <PathBreadcrumb path={op.file} className="min-w-0 truncate" />
                      </>
                    ) : null}
                  </div>
                </OperationTrailItem>
              );
            }

            if (op.type === "shell") {
              return (
                  <OperationTrailItem key={op.id} type={op.type}>
                    <ExpandableRow
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
                      storageKey={`op:${op.id}:shell`}
                    />
                  ) : null}
                    </ExpandableRow>
                  </OperationTrailItem>
              );
            }

            if (op.type === "skill" && op.skillRead) {
              return (
                <OperationTrailItem key={op.id} type={op.type}>
                  <SkillReadPane
                    skillName={op.skillRead.skillName}
                    pluginName={op.skillRead.pluginName}
                    output={op.skillRead.output}
                    status={op.status}
                  />
                </OperationTrailItem>
              );
            }

            if (op.type === "message") {
              return (
                <OperationTrailItem key={op.id} type={op.type}>
                  <MessageToolPane op={op} expanded={isExpanded} onToggle={toggle(op.id)} />
                </OperationTrailItem>
              );
            }

            if (op.type === "memory") {
              return (
                <OperationTrailItem key={op.id} type={op.type}>
                  <MemoryToolPane op={op} expanded={isExpanded} onToggle={toggle(op.id)} />
                </OperationTrailItem>
              );
            }

            if (op.type === "delegate") {
              return (
                <OperationTrailItem key={op.id} type={op.type}>
                  <DelegateToolPane op={op} expanded={isExpanded} onToggle={toggle(op.id)} />
                </OperationTrailItem>
              );
            }

            if (op.type === "goal") {
              return (
                <OperationTrailItem key={op.id} type={op.type}>
                  <GoalToolPane op={op} expanded={isExpanded} onToggle={toggle(op.id)} />
                </OperationTrailItem>
              );
            }

            if (op.type === "question") {
              return (
                <OperationTrailItem key={op.id} type={op.type}>
                  <QuestionToolPane op={op} expanded={isExpanded} onToggle={toggle(op.id)} />
                </OperationTrailItem>
              );
            }

            if (op.type === "procedure" || op.type === "schedule" || op.type === "tool") {
              return (
                <OperationTrailItem key={op.id} type={op.type}>
                  <ExpandableRow
                  expanded={isExpanded}
                  onToggle={toggle(op.id)}
                  header={<ToolHeader op={op} />}
                  trailing={<ToolTrailing op={op} />}
                >
                  <PrettyToolDetailDetail op={op} />
                  </ExpandableRow>
                </OperationTrailItem>
              );
            }

            return null;
          })}
        </div>
      )}
    </div>
  );
}
