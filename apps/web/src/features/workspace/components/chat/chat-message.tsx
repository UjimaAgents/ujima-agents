import { CheckCircle2 } from "lucide-react";
import { Avatar, TagBadge, type TagVariant } from "./primitives";

export interface ChatMessageData {
  id: string;
  role: string;
  name: string;
  time: string;
  content: string;
  detail?: string;
  tag?: { label: string; variant: TagVariant };
  status?: "success" | "warning";
}

export function ChatMessage({
  message,
  active,
  onClick,
  colorIndex = 0,
}: {
  message: ChatMessageData;
  active?: boolean;
  onClick?: () => void;
  colorIndex?: number;
}) {
  return (
    <div
      onClick={onClick}
      className={`relative group flex gap-3 px-3 py-2.5 rounded-xl transition-all cursor-pointer ${
        active
          ? "bg-violet-50/50 ring-1 ring-violet-200 dark:bg-violet-500/5 dark:ring-violet-500/20"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
      }`}
    >
      <Avatar name={message.name} colorIndex={colorIndex} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-bold text-zinc-900 dark:text-white">
            {message.name}
          </p>
          <p className="text-[10px] text-zinc-400">{message.time}</p>
          {message.tag && (
            <TagBadge variant={message.tag.variant} label={message.tag.label} />
          )}
        </div>
        <p className="mt-0.5 text-xs font-semibold text-zinc-900 dark:text-white">
          {message.content}
        </p>
        {message.detail && (
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
            {message.detail}
          </p>
        )}
      </div>
      {active && (
        <div className="absolute -left-0.5 top-1/2 -translate-y-1/2 h-8 w-0.5 rounded-full bg-violet-600" />
      )}
      {message.status === "success" && (
        <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-emerald-500" />
      )}
    </div>
  );
}

export function ChatMessageList({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
      {children}
    </div>
  );
}
