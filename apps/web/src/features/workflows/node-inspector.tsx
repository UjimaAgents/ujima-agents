"use client";

import { Trash2 } from "lucide-react";
import type { WorkflowNode, WorkflowNodeKind } from "@ujima/shared";
import { FieldShell, TextArea, TextInput } from "@/components/ui/form-fields";
import { NODE_KIND_STYLES } from "./nodes";
import type { WorkflowCatalog } from "./use-workflows";

const SELECT_CLASS =
  "w-full rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

/** Short explanation of what each node type does + how it works. */
const NODE_HELP: Record<WorkflowNodeKind, string> = {
  trigger:
    "The entry point. The workflow starts here when you run it (channel Run button or @workflow). Whatever you type as input flows in as {{input}}.",
  agent:
    "A step run by an agent. It reads the upstream documents, does the work, saves a file, then hands off to the next step.",
  approval:
    "A human gate. The workflow pauses here until someone approves or rejects in the run view before the next step runs. (An agent approver is on the roadmap.)",
  goal_handoff:
    "Terminal step. Creates a goal from the workflow's output, then the goal system takes over the follow-up work.",
  skill:
    "A skill capability attached to an agent (dashed link) — the agent may use it while running its step. It is not a step on its own.",
  tool:
    "A tool capability attached to an agent (dashed link) — the agent may call it while running its step. It is not a step on its own.",
};

interface Props {
  node: WorkflowNode | null;
  catalog: WorkflowCatalog;
  onChange: (next: WorkflowNode) => void;
  onDelete: () => void;
}

/** Immutably patch a node's config, preserving its discriminated `kind`. */
function patch(node: WorkflowNode, config: Record<string, unknown>): WorkflowNode {
  return { ...node, config: { ...node.config, ...config } } as WorkflowNode;
}

export function NodeInspector({ node, catalog, onChange, onDelete }: Props) {
  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
        Select a node to edit it, or drag one in from the palette.
      </div>
    );
  }

  const style = NODE_KIND_STYLES[node.kind];
  const Icon = style.icon;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${style.iconWrap}`}>
            <Icon className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{style.label}</span>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
          aria-label="Delete node"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <p className="border-b border-zinc-200 px-4 py-2.5 text-xs leading-5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        {NODE_HELP[node.kind]}
      </p>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <FieldShell label="Label" htmlFor="node-label" hint="Optional display name for this node.">
          <TextInput
            id="node-label"
            value={node.label ?? ""}
            placeholder={style.label}
            onChange={(e) => onChange({ ...node, label: e.target.value })}
          />
        </FieldShell>

        {node.kind === "trigger" && (
          <FieldShell label="Source" htmlFor="trigger-source" hint="How this workflow is started.">
            <select
              id="trigger-source"
              className={SELECT_CLASS}
              value={node.config.source}
              onChange={(e) => onChange(patch(node, { source: e.target.value }))}
            >
              <option value="manual">Manual</option>
              <option value="mention">@workflow mention</option>
              <option value="tool">Tool (workflow.run)</option>
            </select>
          </FieldShell>
        )}

        {node.kind === "agent" && (
          <>
            <FieldShell label="Agent" htmlFor="agent-id" hint="The agent that runs this step.">
              <select
                id="agent-id"
                className={SELECT_CLASS}
                value={node.config.agentId}
                onChange={(e) => onChange(patch(node, { agentId: e.target.value }))}
              >
                <option value="">Select an agent…</option>
                {catalog.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.role}
                  </option>
                ))}
                {node.config.agentId && !catalog.agents.some((a) => a.id === node.config.agentId) && (
                  <option value={node.config.agentId}>{node.config.agentId} (current)</option>
                )}
              </select>
            </FieldShell>
            <FieldShell
              label="Prompt"
              htmlFor="agent-prompt"
              hint="Tokens: {{input}}, {{workflow_run_id}}, {{node.output}}, {{nodes.<id>.output|summary|json}}."
            >
              <TextArea
                id="agent-prompt"
                rows={6}
                value={node.config.prompt}
                placeholder="Write a BRD for {{input}}. Save it to {{node.output}}."
                onChange={(e) => onChange(patch(node, { prompt: e.target.value }))}
              />
            </FieldShell>
            <FieldShell
              label="Output path"
              htmlFor="agent-output"
              hint="Where the agent saves its document. Defaults to workflows/<run>/<node>.md."
            >
              <TextInput
                id="agent-output"
                value={node.config.outputPath ?? ""}
                placeholder="docs/{{workflow_run_id}}/brd.md"
                onChange={(e) => onChange(patch(node, { outputPath: e.target.value || undefined }))}
              />
            </FieldShell>
          </>
        )}

        {node.kind === "skill" && (
          <FieldShell
            label="Skill"
            htmlFor="skill-name"
            hint={
              catalog.skills.length > 0
                ? "Attached to an agent as an ai_skill capability."
                : "No installed skills found — type a skill name. Install skills in Settings."
            }
          >
            {catalog.skills.length > 0 ? (
              <select
                id="skill-name"
                className={SELECT_CLASS}
                value={node.config.skillName}
                onChange={(e) => onChange(patch(node, { skillName: e.target.value }))}
              >
                <option value="">Select a skill…</option>
                {catalog.skills.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
                {node.config.skillName && !catalog.skills.some((s) => s.name === node.config.skillName) && (
                  <option value={node.config.skillName}>{node.config.skillName} (current)</option>
                )}
              </select>
            ) : (
              <TextInput
                id="skill-name"
                value={node.config.skillName}
                placeholder="e.g. brd"
                onChange={(e) => onChange(patch(node, { skillName: e.target.value }))}
              />
            )}
          </FieldShell>
        )}

        {node.kind === "tool" && (
          <FieldShell label="Tool" htmlFor="tool-id" hint="Attached to an agent as an ai_tool capability.">
            <select
              id="tool-id"
              className={SELECT_CLASS}
              value={node.config.toolId}
              onChange={(e) => onChange(patch(node, { toolId: e.target.value }))}
            >
              <option value="">Select a tool…</option>
              {Object.entries(
                catalog.tools.reduce<Record<string, typeof catalog.tools>>((acc, t) => {
                  (acc[t.group] ??= []).push(t);
                  return acc;
                }, {}),
              ).map(([group, tools]) => (
                <optgroup key={group} label={group}>
                  {tools.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              ))}
              {node.config.toolId && !catalog.tools.some((t) => t.id === node.config.toolId) && (
                <option value={node.config.toolId}>{node.config.toolId} (current)</option>
              )}
            </select>
          </FieldShell>
        )}

        {node.kind === "approval" && (
          <FieldShell label="Prompt" htmlFor="approval-prompt" hint="Optional note shown on the approval card.">
            <TextArea
              id="approval-prompt"
              rows={4}
              value={node.config.prompt ?? ""}
              placeholder="Approve the BRD before engineering starts?"
              onChange={(e) => onChange(patch(node, { prompt: e.target.value || undefined }))}
            />
          </FieldShell>
        )}

        {node.kind === "goal_handoff" && (
          <>
            <FieldShell label="Goal title" htmlFor="goal-title" hint="Supports tokens like {{input}}.">
              <TextInput
                id="goal-title"
                value={node.config.titleTemplate}
                placeholder="{{input}}"
                onChange={(e) => onChange(patch(node, { titleTemplate: e.target.value }))}
              />
            </FieldShell>
            <FieldShell label="Tasks from" htmlFor="goal-tasks-from" hint="Where the goal's tasks come from.">
              <select
                id="goal-tasks-from"
                className={SELECT_CLASS}
                value={node.config.tasksFrom}
                onChange={(e) => onChange(patch(node, { tasksFrom: e.target.value }))}
              >
                <option value="json">Upstream node json</option>
                <option value="template">Template (JSON)</option>
              </select>
            </FieldShell>
            {node.config.tasksFrom === "template" && (
              <FieldShell label="Tasks template" htmlFor="goal-tasks-template" hint="A JSON array of tasks.">
                <TextArea
                  id="goal-tasks-template"
                  rows={5}
                  value={node.config.tasksTemplate ?? ""}
                  placeholder='[{"title": "Build auth"}]'
                  onChange={(e) => onChange(patch(node, { tasksTemplate: e.target.value || undefined }))}
                />
              </FieldShell>
            )}
          </>
        )}
      </div>
    </div>
  );
}
