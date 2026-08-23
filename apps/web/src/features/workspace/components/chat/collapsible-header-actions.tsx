"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, MoreHorizontal, SquarePen, Type } from "lucide-react";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { Member, ShellApprovalMode } from "@ujima/shared/browser";
import { CHAT_FONT_SIZE_OPTIONS, type ChatFontSize } from "../../workspace-store";
import { AgentChatHeaderControls } from "./agent-chat-header-controls";
import { ChannelChatHeaderControls } from "./channel-chat-header-controls";

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
  const [fontOpen, setFontOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedSize = CHAT_FONT_SIZE_OPTIONS.find((option) => option.value === props.chatFontSize);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !menuRef.current?.contains(target)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  return (
    <div ref={menuRef} className="relative ml-auto">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className="flex items-center justify-center rounded-md p-1 text-zinc-400 transition-all duration-200 hover:bg-zinc-100 hover:text-zinc-600 active:scale-95 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        aria-label="Chat options"
        title="Chat options"
        aria-expanded={menuOpen}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {menuOpen ? (
        <div className="absolute bottom-full right-0 z-50 mb-2 w-[min(18rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-zinc-200 bg-white p-1.5 shadow-[0_10px_30px_-5px_rgba(0,0,0,0.16)] dark:border-zinc-800 dark:bg-zinc-950 animate-in fade-in slide-in-from-bottom-1 duration-150">
          <div className="border-b border-zinc-100/50 pb-1.5 dark:border-zinc-800/50">
            <button
              type="button"
              onClick={() => setFontOpen((open) => !open)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-zinc-900 transition hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
              aria-expanded={fontOpen}
            >
              <Type className="h-4 w-4 text-zinc-500 dark:text-zinc-300" />
              <span className="min-w-0 flex-1">Text font</span>
              <span className="text-xs text-zinc-400">{selectedSize?.label}</span>
              <ChevronDown className={`h-3.5 w-3.5 text-zinc-400 transition-transform ${fontOpen ? "rotate-180" : ""}`} />
            </button>
            {fontOpen ? (
              <div className="mt-0.5 flex flex-col pl-8">
                {CHAT_FONT_SIZE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => props.onChatFontSizeChange(option.value)}
                    className={`flex items-center rounded-md px-2 py-1.5 text-left text-[13px] font-medium transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                      props.chatFontSize === option.value
                        ? "text-zinc-900 dark:text-white"
                        : "text-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {option.label}
                    {props.chatFontSize === option.value ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5 pt-1.5">
            {props.kind === "agent" && props.onOpenAgentEditor ? (
              <button
                type="button"
                onClick={() => {
                  props.onOpenAgentEditor?.();
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium text-zinc-900 transition hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                <SquarePen className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-300" />
                Edit Agent
              </button>
            ) : null}
            <HeaderControls props={props} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HeaderControls({ props }: { props: Props }) {
  if (props.kind === "channel") {
    return <ChannelChatHeaderControls value={props.channelValue} onChange={props.onChannelChange} />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <AgentChatHeaderControls
        orgId={props.orgId}
        member={props.agentMember}
        providers={props.providers}
        orgShellApprovalMode={props.orgShellApprovalMode}
        goalMode={props.goalMode}
        onMemberUpdated={props.onMemberUpdated}
      />
    </div>
  );
}
