"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { ChannelView } from "./channel-view";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { SelectedConversation } from "../types";

import type { RolePresetTemplate } from "../../onboarding/types";

export function WorkspaceShell({ 
  bootstrap,
  rolePresets,
  initialConversation,
}: { 
  bootstrap: BootstrapResponse;
  rolePresets: RolePresetTemplate[];
  initialConversation?: SelectedConversation;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sidebarWidth, setSidebarWidth] = useState(25);

  const defaultConversation = useMemo(() => {
    if (initialConversation) return initialConversation;
    const generalChannel =
      bootstrap.channels.find((c) => c.name === "general") ??
      bootstrap.channels[0];
    return {
      type: "channel" as const,
      id: generalChannel?.id ?? "general",
      name: generalChannel?.name ?? "general",
    };
  }, [bootstrap.channels, initialConversation]);

  const resolveUrlConversation = useCallback(() => {
    const agentValue = searchParams.get("agent");
    if (agentValue) {
      const agent = bootstrap.members.find(
        (member) =>
          member.kind === "agent" &&
          (member.name === agentValue || member.id === agentValue),
      );
      if (agent) {
        return { type: "agent" as const, id: agent.id, name: agent.name };
      }
    }

    const channelValue = searchParams.get("channel");
    if (channelValue) {
      const channel = bootstrap.channels.find(
        (item) => item.name === channelValue || item.id === channelValue,
      );
      if (channel) {
        return { type: "channel" as const, id: channel.id, name: channel.name };
      }
    }

    return defaultConversation;
  }, [bootstrap.channels, bootstrap.members, defaultConversation, searchParams]);

  const selected = useMemo(() => resolveUrlConversation(), [resolveUrlConversation]);

  const handleSelect = useCallback(
    (conversation: SelectedConversation) => {
      const param =
        conversation.type === "agent"
          ? `agent=${encodeURIComponent(conversation.name)}`
          : `channel=${encodeURIComponent(conversation.name)}`;
      router.replace(`/workspace?${param}`, { scroll: false });
    },
    [router],
  );

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50 dark:bg-[#040712]">
      <div
        style={{ width: `${sidebarWidth}%`, minWidth: 220, maxWidth: "40%" }}
        className="shrink-0 h-full"
      >
        <WorkspaceSidebar
          bootstrap={bootstrap}
          rolePresets={rolePresets}
          selected={selected}
          onSelect={handleSelect}
        />
      </div>
      <DragHandle onResize={setSidebarWidth} />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden h-full">
        <ChannelView
          bootstrap={bootstrap}
          conversation={selected}
        />
      </main>
    </div>
  );
}

export function DragHandle({
  onResize,
  side = "left",
  className = "",
}: {
  onResize: (percent: number) => void;
  side?: "left" | "right";
  className?: string;
}) {
  const handleRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const container = handleRef.current?.parentElement;
      if (!container) return;

      const onMouseMove = (e: MouseEvent) => {
        if (!isDragging.current || !container) return;
        const rect = container.getBoundingClientRect();
        const containerWidth = rect.width;
        const relativeX = e.clientX - rect.left;

        if (side === "left") {
          const percent = (relativeX / containerWidth) * 100;
          onResize(Math.min(Math.max(percent, 15), 40));
        } else {
          const rightPercent =
            ((containerWidth - relativeX) / containerWidth) * 100;
          onResize(Math.min(Math.max(rightPercent, 15), 45));
        }
      };

      const onMouseUp = () => {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [onResize, side],
  );

  return (
    <div
      ref={handleRef}
      onMouseDown={onMouseDown}
      className={`group relative flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-zinc-200 transition-colors hover:bg-violet-500/40 dark:bg-zinc-800 dark:hover:bg-violet-500/30 ${className}`}
    >
      <div className="pointer-events-none absolute z-50 flex h-8 w-5 items-center justify-center rounded-full border border-zinc-300 bg-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 dark:border-zinc-600 dark:bg-zinc-800">
        <GripVertical className="h-3.5 w-3.5 text-zinc-400 group-hover:text-violet-500" />
      </div>
    </div>
  );
}
