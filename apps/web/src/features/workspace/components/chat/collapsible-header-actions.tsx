"use client";

import { useState } from "react";
import { Check, MoreHorizontal, SquarePen, Type } from "lucide-react";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { Member, ShellApprovalMode } from "@ujima/shared/browser";
import type { ChatFontSize } from "../../workspace-store";
import { AgentChatHeaderControls } from "./agent-chat-header-controls";
import { ChannelChatHeaderControls } from "./channel-chat-header-controls";

const SIZE_OPTIONS: { value: ChatFontSize; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
  { value: "xlarge", label: "X-Large" },
  { value: "xxlarge", label: "2X Large" },
  { value: "3xlarge", label: "3X Large" },
  { value: "6xlarge", label: "6X Large" },
];

interface AgentHeaderProps {
  kind: "agent";
  orgId: string;
  agentMember: Member;
  providers: BootstrapResponse["providers"];
  orgShellApprovalMode: ShellApprovalMode;
  goalMode: boolean;
  onMemberUpdated: (member: Member) => void;
  onOpenAgentEditor?: () => void;
}

interface ChannelHeaderProps {
  kind: "channel";
  channelValue: ShellApprovalMode;
  onChannelChange: (value: ShellApprovalMode) => Promise<void> | void;
}

interface SharedHeaderProps {
  chatFontSize: ChatFontSize;
  onChatFontSizeChange: (size: ChatFontSize) => void;
}

type Props = SharedHeaderProps & (AgentHeaderProps | ChannelHeaderProps);

export function CollapsibleHeaderActions(props: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="relative ml-auto">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className="flex items-center justify-center rounded-lg p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all duration-200 active:scale-95"
        aria-label="More header options"
        aria-expanded={menuOpen}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {menuOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setMenuOpen(false)}
            aria-label="Close header options"
          />
          <div className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-zinc-200/50 bg-white/90 p-3.5 shadow-[0_10px_30px_-5px_rgba(0,0,0,0.08),_0_0_1px_rgba(0,0,0,0.03)] backdrop-blur-sm dark:border-zinc-800/50 dark:bg-zinc-950/90 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 ease-out">
            <div className="border-b border-zinc-100/50 pb-3 dark:border-zinc-800/50">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                <Type className="h-3 w-3" />
                Font size
              </div>
              <div className="grid grid-cols-2 gap-1">
                {SIZE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => props.onChatFontSizeChange(option.value)}
                    className={`flex items-center rounded px-2 py-1 text-[11px] font-semibold transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                      props.chatFontSize === option.value
                        ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                        : "text-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {option.label}
                    {props.chatFontSize === option.value ? <Check className="ml-auto h-3 w-3" /> : null}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3 pt-3">
              <HeaderControls props={props} onClose={() => setMenuOpen(false)} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function HeaderControls({ props, onClose }: { props: Props; onClose?: () => void }) {
  if (props.kind === "channel") {
    return <ChannelChatHeaderControls value={props.channelValue} onChange={props.onChannelChange} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <AgentChatHeaderControls
        orgId={props.orgId}
        member={props.agentMember}
        providers={props.providers}
        orgShellApprovalMode={props.orgShellApprovalMode}
        goalMode={props.goalMode}
        onMemberUpdated={props.onMemberUpdated}
      />
      {props.onOpenAgentEditor ? (
        <div className="border-t border-zinc-100/50 pt-3 dark:border-zinc-800/50">
          <button
            type="button"
            onClick={() => {
              props.onOpenAgentEditor?.();
              onClose?.();
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700/60 dark:bg-zinc-900/30 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <SquarePen className="h-3.5 w-3.5" />
            Edit Agent Details
          </button>
        </div>
      ) : null}
    </div>
  );
}
