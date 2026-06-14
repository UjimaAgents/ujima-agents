"use client";

import { useState } from "react";
import { Check, MoreHorizontal, SquarePen, Type } from "lucide-react";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { Member, ShellApprovalMode } from "@ujima/shared/browser";
import type { ChatFontSize } from "../../workspace-store";
import { AgentChatHeaderControls } from "./agent-chat-header-controls";
import { ChannelChatHeaderControls } from "./channel-chat-header-controls";
import { FontSizeControl } from "./font-size-control";

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
      <div className="chat-header-actions-full items-center justify-end gap-2">
        <FontSizeControl value={props.chatFontSize} onChange={props.onChatFontSizeChange} />
        <HeaderControls props={props} />
      </div>

      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className="chat-header-actions-compact items-center justify-center rounded-lg px-3 py-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        aria-label="More header options"
        aria-expanded={menuOpen}
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>

      {menuOpen ? (
        <>
          <button
            type="button"
            className="chat-header-actions-compact fixed inset-0 z-40 cursor-default"
            onClick={() => setMenuOpen(false)}
            aria-label="Close header options"
          />
          <div className="chat-header-actions-menu absolute right-0 top-full z-50 mt-1 w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-zinc-200 bg-white p-3 shadow-lg shadow-black/5 dark:border-zinc-700 dark:bg-zinc-900">
            <div className="border-b border-zinc-100 pb-3 dark:border-zinc-800">
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
            <div className="flex flex-col items-stretch gap-2 pt-3">
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
    <>
      <AgentChatHeaderControls
        orgId={props.orgId}
        member={props.agentMember}
        providers={props.providers}
        orgShellApprovalMode={props.orgShellApprovalMode}
        goalMode={props.goalMode}
        onMemberUpdated={props.onMemberUpdated}
      />
      {props.onOpenAgentEditor ? (
        <button
          type="button"
          onClick={() => {
            props.onOpenAgentEditor?.();
            onClose?.();
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <SquarePen className="h-3.5 w-3.5" />
          Edit
        </button>
      ) : null}
    </>
  );
}
