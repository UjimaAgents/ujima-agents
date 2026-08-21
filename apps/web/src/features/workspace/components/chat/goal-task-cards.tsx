import { memo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  KanbanSquare,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { BootstrapResponse } from "@ujima/api-schema";
import {
  formatGoalStatusLabel,
  goalTaskColumnLabel,
  type GoalTaskStatus,
  type MessageCard,
} from "@ujima/shared/browser";
import { Avatar } from "./primitives";
import { TASK_STATUS_DOT_CLASS, TASK_STATUS_PILL_CLASS } from "../../lib/status-tones";

type GoalBoardCreatedCard = Extract<MessageCard, { kind: "goal.board.created" }>;
type GoalTaskUpdatedCard = Extract<MessageCard, { kind: "goal.task.updated" }>;
type TaskJoinCard = Extract<MessageCard, { kind: "task.join" }>;
type TaskOriginLinkCard = Extract<MessageCard, { kind: "task.origin-link" }>;
type TaskSummaryCard = Extract<MessageCard, { kind: "task.summary" }>;
type ScheduleCard = Extract<MessageCard, { kind: "schedule" }>;

type WorkspaceMember = BootstrapResponse["members"][number];

export interface GoalTaskCardActions {
  members: WorkspaceMember[];
  onOpenTasksTab?: () => void;
  onNavigateChannel?: (channelId: string) => void;
}

function memberName(members: WorkspaceMember[], memberId: string): string {
  return members.find((member) => member.id === memberId)?.name ?? memberId;
}

function CardShell({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mt-3 overflow-hidden rounded-xl bg-zinc-50/70 shadow-sm ring-1 ring-zinc-200/50 dark:bg-zinc-900/30 dark:ring-zinc-800/60 animate-in fade-in-50 duration-200">
      <div className="px-3 py-3">{children}</div>
      {footer ? (
        <div className="border-t border-zinc-200/60 px-3 py-2 dark:border-zinc-800/60">{footer}</div>
      ) : null}
    </div>
  );
}

function ViewBoardButton({ onOpenTasksTab }: { onOpenTasksTab?: () => void }) {
  if (!onOpenTasksTab) return null;
  return (
    <button
      type="button"
      onClick={onOpenTasksTab}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-violet-700 transition hover:bg-violet-500/10 dark:text-violet-300"
    >
      <KanbanSquare className="h-3 w-3" />
      View board
    </button>
  );
}

const TASK_EVENT_ICON_CLASS = {
  amber: "bg-amber-100/80 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  emerald: "bg-emerald-100/80 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  neutral: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  violet: "bg-violet-100/80 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
} as const;

type TaskEventTone = keyof typeof TASK_EVENT_ICON_CLASS;

const TASK_EVENT_EYEBROW_CLASS =
  "text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500";
const TASK_EVENT_META_CLASS = "text-[11px] text-zinc-500 dark:text-zinc-400";
const TASK_EVENT_TITLE_CLASS = "break-words text-sm font-semibold leading-5 text-zinc-900 dark:text-zinc-100";

function TaskEventShell({
  action,
  children,
  icon: Icon,
  tone,
}: {
  action?: ReactNode;
  children: ReactNode;
  icon: LucideIcon;
  tone: TaskEventTone;
}) {
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200/60 bg-zinc-50/40 animate-in fade-in-50 duration-200 dark:border-zinc-800/70 dark:bg-zinc-900/20">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <div
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${TASK_EVENT_ICON_CLASS[tone]}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">{children}</div>
        {action ? <div className="shrink-0 self-center">{action}</div> : null}
      </div>
    </div>
  );
}

function TaskStatusPill({ status }: { status: GoalTaskStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${TASK_STATUS_PILL_CLASS[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {goalTaskColumnLabel(status)}
    </span>
  );
}

function formatScheduleTime(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function scheduleActionLabel(card: ScheduleCard): string {
  if (card.action === "created") return "Schedule created";
  if (card.action === "cancelled") return card.removed === false ? "Schedule not found" : "Schedule cancelled";
  return "Schedules listed";
}

export const GoalBoardCreatedCardView = memo(function GoalBoardCreatedCardView({
  card,
  members,
  onOpenTasksTab,
}: { card: GoalBoardCreatedCard } & GoalTaskCardActions) {
  const visibleTasks = card.tasks.slice(0, 5);
  const overflow = card.tasks.length - visibleTasks.length;

  return (
    <CardShell footer={<ViewBoardButton onOpenTasksTab={onOpenTasksTab} />}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Goal board created
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {card.goalTitle}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-violet-100/80 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
          {formatGoalStatusLabel(card.goalStatus)}
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {visibleTasks.map((task) => (
          <li key={task.id} className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TASK_STATUS_DOT_CLASS[task.status]}`} />
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-800 dark:text-zinc-200">
              {task.title}
            </span>
            <Avatar name={memberName(members, task.assigneeId)} size="xs" />
          </li>
        ))}
      </ul>
      {overflow > 0 ? (
        <p className="mt-2 text-[10px] font-mono text-zinc-400 dark:text-zinc-500">+{overflow} more</p>
      ) : null}
    </CardShell>
  );
});

export const GoalTaskUpdatedCardView = memo(function GoalTaskUpdatedCardView({
  card,
  members,
  onOpenTasksTab,
}: { card: GoalTaskUpdatedCard } & GoalTaskCardActions) {
  const [handoverOpen, setHandoverOpen] = useState(false);
  const actorName =
    card.actorMemberId && card.actorMemberId !== card.assigneeId
      ? memberName(members, card.actorMemberId)
      : null;
  const assigneeName = memberName(members, card.assigneeId);
  const statusChanged = card.previousStatus !== card.status;

  return (
    <TaskEventShell
      action={<ViewBoardButton onOpenTasksTab={onOpenTasksTab} />}
      icon={ArrowRight}
      tone="violet"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <p className={TASK_EVENT_EYEBROW_CLASS}>{statusChanged ? "Moved" : "Updated"}</p>
        {actorName ? <span className={TASK_EVENT_META_CLASS}>by {actorName}</span> : null}
      </div>
      <p className={`mt-0.5 ${TASK_EVENT_TITLE_CLASS}`}>{card.taskTitle}</p>
      <div className={`mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 ${TASK_EVENT_META_CLASS}`}>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Avatar name={assigneeName} size="xs" />
          <span className="truncate font-medium">{assigneeName}</span>
        </span>
        <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-500">·</span>
        {statusChanged ? (
          <>
            <span>{goalTaskColumnLabel(card.previousStatus)}</span>
            <ArrowRight className="h-3 w-3 shrink-0 text-zinc-400" />
          </>
        ) : null}
        <TaskStatusPill status={card.status} />
      </div>
      {card.handoverSummary ? (
        <div className="mt-2">
          <button
            type="button"
            aria-expanded={handoverOpen}
            onClick={() => setHandoverOpen((open) => !open)}
            className={`inline-flex items-center gap-1 ${TASK_EVENT_META_CLASS} transition hover:text-zinc-800 dark:hover:text-zinc-200`}
          >
            Handover note
            {handoverOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {handoverOpen ? (
            <p className={`mt-1 border-l border-zinc-300 pl-2 leading-relaxed dark:border-zinc-700 ${TASK_EVENT_META_CLASS}`}>
              {card.handoverSummary}
            </p>
          ) : null}
        </div>
      ) : null}
    </TaskEventShell>
  );
});

export const TaskJoinCardView = memo(function TaskJoinCardView({
  card,
  members,
}: { card: TaskJoinCard } & GoalTaskCardActions) {
  const joined = card.memberIds.map((id) => memberName(members, id));
  return (
    <CardShell>
      <div className="flex items-center gap-2">
        <Users className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
        <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Task session started
        </p>
      </div>
      <p className="mt-2 text-sm text-zinc-800 dark:text-zinc-200">
        {joined.length > 0 ? joined.join(", ") : "Team"} joined
      </p>
    </CardShell>
  );
});

export const TaskOriginLinkCardView = memo(function TaskOriginLinkCardView({
  card,
  onNavigateChannel,
}: { card: TaskOriginLinkCard } & GoalTaskCardActions) {
  return (
    <CardShell>
      <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        Task run
      </p>
      <p className="mt-2 text-sm text-zinc-800 dark:text-zinc-200">
        Started #{card.taskSlug}
      </p>
      {onNavigateChannel ? (
        <button
          type="button"
          onClick={() => onNavigateChannel(card.taskChannelId)}
          className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] text-violet-700 dark:text-violet-300"
        >
          Follow #{card.taskSlug}
          <ExternalLink className="h-3 w-3" />
        </button>
      ) : null}
    </CardShell>
  );
});

const OUTCOME_CLASS = {
  completed: "bg-emerald-100/90 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "bg-red-100/90 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  cancelled: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
} as const;

export const TaskSummaryCardView = memo(function TaskSummaryCardView({
  card,
  onNavigateChannel,
}: { card: TaskSummaryCard } & GoalTaskCardActions) {
  const channelId = card.taskChannelId;
  return (
    <CardShell>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Task {card.taskSlug ? `#${card.taskSlug}` : "session"}
        </p>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${OUTCOME_CLASS[card.outcome]}`}>
          {card.outcome}
        </span>
      </div>
      {card.summary ? (
        <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{card.summary}</p>
      ) : null}
      {channelId && onNavigateChannel ? (
        <button
          type="button"
          onClick={() => onNavigateChannel(channelId)}
          className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] text-violet-700 dark:text-violet-300"
        >
          Open task channel
          <ExternalLink className="h-3 w-3" />
        </button>
      ) : null}
    </CardShell>
  );
});

export const ScheduleCardView = memo(function ScheduleCardView({
  card,
  onNavigateChannel,
}: { card: ScheduleCard } & GoalTaskCardActions) {
  const nextRun = formatScheduleTime(card.nextRunAt);
  const listedJobs = card.jobs.slice(0, 4);
  const title =
    card.action === "listed"
      ? `${card.jobs.length} ${card.jobs.length === 1 ? "schedule" : "schedules"}`
      : card.name ?? "Schedule";

  return (
    <CardShell
      footer={
        card.channelId && onNavigateChannel ? (
          <button
            type="button"
            onClick={() => onNavigateChannel(card.channelId!)}
            className="inline-flex items-center gap-1 font-mono text-[10px] text-violet-700 dark:text-violet-300"
          >
            Open channel
            <ExternalLink className="h-3 w-3" />
          </button>
        ) : null
      }
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-100/80 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          <Clock className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {scheduleActionLabel(card)}
            </p>
            {card.status ? (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {card.status}
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </p>
          {card.cronExpression ? (
            <p className="mt-1 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
              {card.cronExpression}
              {nextRun ? ` · next ${nextRun}` : ""}
              {card.runCount ? ` · runs ${card.runCount}` : ""}
            </p>
          ) : null}
          {card.prompt ? (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
              {card.prompt}
            </p>
          ) : null}
          {listedJobs.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {listedJobs.map((job) => (
                <li key={job.id} className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-200">
                    {job.name}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                    {job.cronExpression}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </CardShell>
  );
});

export const MessageCardsView = memo(function MessageCardsView({
  cards,
  ...actions
}: { cards: MessageCard[] } & GoalTaskCardActions) {
  return (
    <>
      {cards.map((card) => {
        switch (card.kind) {
          case "goal.board.created":
            return <GoalBoardCreatedCardView key={card.cardId} card={card} {...actions} />;
          case "goal.task.updated":
            return <GoalTaskUpdatedCardView key={card.cardId} card={card} {...actions} />;
          case "task.join":
            return <TaskJoinCardView key={card.cardId} card={card} {...actions} />;
          case "task.origin-link":
            return <TaskOriginLinkCardView key={card.cardId} card={card} {...actions} />;
          case "task.summary":
            return <TaskSummaryCardView key={card.cardId} card={card} {...actions} />;
          case "schedule":
            return <ScheduleCardView key={card.cardId} card={card} {...actions} />;
          case "artifact.file":
          case "approval":
          case "task.promotion-confirm":
          case "tool.call":
            // Rendered by dedicated components upstream (chat-message), not here.
            return null;
          default: {
            const _exhaustive: never = card;
            return _exhaustive;
          }
        }
      })}
    </>
  );
});

export interface TaskNudgeData {
  taskId: string;
  taskTitle: string;
  reason: "unblocked" | "idle" | "stalled" | "moved";
  assigneeId: string;
  completedDependencyId?: string;
  completedDependencyTitle?: string;
  previousStatus?: GoalTaskStatus;
  status?: GoalTaskStatus;
}

export const TaskNudgeCardView = memo(function TaskNudgeCardView({
  nudge,
  onOpenTasksTab,
}: {
  nudge: TaskNudgeData;
  onOpenTasksTab?: () => void;
}) {
  if (!nudge) return null;

  const config = {
    unblocked: {
      title: "Unblocked",
      icon: Zap,
      tone: "emerald" as const,
      description: nudge.completedDependencyTitle
        ? `Dependency “${nudge.completedDependencyTitle}” completed · ready to start`
        : "All dependencies completed · ready to start",
    },
    stalled: {
      title: "Stalled",
      icon: AlertTriangle,
      tone: "amber" as const,
      description: "No progress update while in progress",
    },
    idle: {
      title: "Pending",
      icon: Clock,
      tone: "neutral" as const,
      description: "Pending and unblocked · ready to start",
    },
    moved: {
      title: "Moved",
      icon: ArrowRight,
      tone: "violet" as const,
      description: nudge.previousStatus && nudge.status
        ? `Moved from ${goalTaskColumnLabel(nudge.previousStatus)} → ${goalTaskColumnLabel(nudge.status)}`
        : "Task status updated.",
    },
  }[nudge.reason];

  const Icon = config.icon;

  return (
    <TaskEventShell
      action={<ViewBoardButton onOpenTasksTab={onOpenTasksTab} />}
      icon={Icon}
      tone={config.tone}
    >
      <p className={TASK_EVENT_EYEBROW_CLASS}>{config.title}</p>
      <p className={`mt-0.5 ${TASK_EVENT_TITLE_CLASS}`}>{nudge.taskTitle}</p>
      <p className={`mt-1 leading-4 ${TASK_EVENT_META_CLASS}`}>{config.description}</p>
    </TaskEventShell>
  );
});
