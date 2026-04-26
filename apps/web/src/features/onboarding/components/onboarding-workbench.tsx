"use client";

import { Group, Panel, Separator } from "react-resizable-panels";
import type { OnboardingDraft } from "../types";
import { CanvasPanel } from "./canvas-panel";
import { LogTracePanel } from "./log-trace-panel";
import { StreamingTextPanel } from "./streaming-text-panel";
import { ToolCallPanel } from "./tool-call-panel";

export function OnboardingWorkbench({ draft }: { draft: OnboardingDraft }) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/95 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur dark:border-white/10 dark:bg-white/5 dark:shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">AI-assisted onboarding workbench</p>
          <h2 className="mt-2 text-lg font-semibold text-zinc-950 dark:text-zinc-50">Live guidance, tools, traces, and canvas previews</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            This area stays modular so future onboarding and post-onboarding flows can reuse the same workspace primitives.
          </p>
        </div>
      </div>

      <div className="h-[520px] overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <Group orientation="horizontal">
          <Panel defaultSize={48} minSize={35}>
            <Group orientation="vertical">
              <Panel defaultSize={60} minSize={35}>
                <div className="h-full p-2">
                  <StreamingTextPanel />
                </div>
              </Panel>
              <Separator className="h-1 bg-zinc-200 dark:bg-zinc-800" />
              <Panel defaultSize={40} minSize={25}>
                <div className="h-full p-2">
                  <LogTracePanel
                    entries={[
                      {
                        id: "1",
                        title: "Step changed: team configuration",
                        detail: "Captured role, agent, and channel configuration changes.",
                        level: "info",
                      },
                      {
                        id: "2",
                        title: "Provider keys not configured",
                        detail: "Submission may fail later if required providers are missing.",
                        level: "warn",
                      },
                    ]}
                  />
                </div>
              </Panel>
            </Group>
          </Panel>
          <Separator className="w-1 bg-zinc-200 dark:bg-zinc-800" />
          <Panel defaultSize={52} minSize={35}>
            <Group orientation="vertical">
              <Panel defaultSize={48} minSize={30}>
                <div className="h-full p-2">
                  <ToolCallPanel
                    tools={[
                      { name: "team.roles.sync", status: "done" },
                      { name: "providers.validate", status: "idle" },
                      { name: "orgChart.preview", status: "running" },
                    ]}
                  />
                </div>
              </Panel>
              <Separator className="h-1 bg-zinc-200 dark:bg-zinc-800" />
              <Panel defaultSize={52} minSize={30}>
                <div className="h-full p-2">
                  <CanvasPanel
                    organizationName={draft.organizationName}
                    ownerName={draft.ownerName}
                    teamRoleCount={draft.roles.length}
                  />
                </div>
              </Panel>
            </Group>
          </Panel>
        </Group>
      </div>
    </div>
  );
}
