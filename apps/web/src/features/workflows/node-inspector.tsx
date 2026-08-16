"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import type { WorkflowNode, WorkflowNodeKind } from "@ujima/shared";
import { FieldShell, TextArea, TextInput } from "@/components/ui/form-fields";
import { NODE_KIND_STYLES } from "./nodes";
import type { WorkflowCatalog } from "./use-workflows";

const SELECT_CLASS =
  "w-full rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-violet-500 disabled:opacity-60 disabled:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:disabled:bg-zinc-900";

/** Short explanation of what each node type does + how it works. */
const NODE_HELP: Record<WorkflowNodeKind, string> = {
  trigger:
    "The entry point. The workflow starts here when you run it (channel Run button or @workflow). Whatever you type as input flows in as {{input}}.",
  agent:
    "A step run by an agent. It reads the upstream documents, does the work, saves a file, then hands off to the next step.",
  approval:
    "A gate. The workflow pauses here until it's approved. By default a human approves in the run view; pick an Approver agent to have an agent review the upstream output and approve/reject automatically.",
  goal_handoff:
    "Terminal step. Creates a goal from the workflow's output, then the goal system takes over the follow-up work.",
  skill:
    "A skill capability attached to an agent (dashed link) — the agent may use it while running its step. It is not a step on its own.",
  tool:
    "A tool capability attached to an agent (dashed link) — the agent may call it while running its step. It is not a step on its own.",
  output:
    "Declares the output format for the step feeding into it. The upstream agent is told to write its document in this format (and at this path), then it's passed to the next step.",
};

interface Props {
  node: WorkflowNode | null;
  catalog: WorkflowCatalog;
  nodes?: WorkflowNode[];
  readOnly?: boolean;
  onChange: (next: WorkflowNode) => void;
  onDelete: () => void;
}

/** Immutably patch a node's config, preserving its discriminated `kind`. */
function patch(node: WorkflowNode, config: Record<string, unknown>): WorkflowNode {
  return { ...node, config: { ...node.config, ...config } } as WorkflowNode;
}

function TokenHelper({
  node,
  nodes,
  onInsert,
  readOnly,
}: {
  node: WorkflowNode;
  nodes?: WorkflowNode[];
  onInsert: (token: string) => void;
  readOnly?: boolean;
}) {
  if (readOnly) return null;
  const upstreamNodes = (nodes ?? []).filter((n) => n.id !== node.id && n.kind === "agent");

  return (
    <div className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
      <span className="self-center font-medium text-zinc-400">Insert token:</span>
      <button
        type="button"
        onClick={() => onInsert("{{input}}")}
        className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      >
        {"{{input}}"}
      </button>
      <button
        type="button"
        onClick={() => onInsert("{{node.output}}")}
        className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      >
        {"{{node.output}}"}
      </button>
      <button
        type="button"
        onClick={() => onInsert("{{workflow_run_id}}")}
        className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      >
        {"{{workflow_run_id}}"}
      </button>
      {upstreamNodes.map((n) => (
        <button
          key={n.id}
          type="button"
          onClick={() => onInsert(`{{nodes.${n.id}.output}}`)}
          className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-violet-700 hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-900/60"
        >
          {`{{nodes.${n.id}.output}}`}
        </button>
      ))}
    </div>
  );
}

export function NodeInspector({ node, catalog, nodes, readOnly, onChange, onDelete }: Props) {
  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
        Select a node to edit it, or drag one in from the palette.
      </div>
    );
  }

  const style = NODE_KIND_STYLES[node.kind];
  const Icon = style.icon;

  const insertPromptToken = (token: string) => {
    if (node.kind === "agent") {
      const current = node.config.prompt ?? "";
      onChange(patch(node, { prompt: current ? `${current} ${token}` : token }));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${style.iconWrap}`}>
            <Icon className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{style.label}</span>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={onDelete}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
            aria-label="Delete node"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
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
            disabled={readOnly}
            onChange={(e) => onChange({ ...node, label: e.target.value })}
          />
        </FieldShell>

        {node.kind === "trigger" && (
          <FieldShell label="Source" htmlFor="trigger-source" hint="How this workflow is started.">
            <select
              id="trigger-source"
              className={SELECT_CLASS}
              value={node.config.source}
              disabled={readOnly}
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
                disabled={readOnly}
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
                disabled={readOnly}
                onChange={(e) => onChange(patch(node, { prompt: e.target.value }))}
              />
              <TokenHelper node={node} nodes={nodes} onInsert={insertPromptToken} readOnly={readOnly} />
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
                disabled={readOnly}
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
              catalog.skills.length > 0 ? (
                "Attached to an agent as an ai_skill capability."
              ) : (
                <span>
                  No installed skills found.{" "}
                  <Link href="/settings/organization?tab=mcps" className="text-violet-600 underline hover:text-violet-700">
                    Install skills in Settings
                  </Link>
                  .
                </span>
              )
            }
          >
            {catalog.skills.length > 0 ? (
              <select
                id="skill-name"
                className={SELECT_CLASS}
                value={node.config.skillName}
                disabled={readOnly}
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
                disabled={readOnly}
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
              disabled={readOnly}
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
          <>
            <FieldShell
              label="Approver"
              htmlFor="approver"
              hint="Who resolves this gate. An agent reviews the upstream output and approves/rejects automatically."
            >
              <select
                id="approver"
                className={SELECT_CLASS}
                value={node.config.approverAgentId ?? ""}
                disabled={readOnly}
                onChange={(e) => onChange(patch(node, { approverAgentId: e.target.value || undefined }))}
              >
                <option value="">Human (approve in the run view)</option>
                {catalog.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.role}
                  </option>
                ))}
                {node.config.approverAgentId && !catalog.agents.some((a) => a.id === node.config.approverAgentId) && (
                  <option value={node.config.approverAgentId}>{node.config.approverAgentId} (current)</option>
                )}
              </select>
            </FieldShell>
            <FieldShell label="Prompt" htmlFor="approval-prompt" hint="Optional note shown on the approval card / given to the approver.">
              <TextArea
                id="approval-prompt"
                rows={4}
                value={node.config.prompt ?? ""}
                placeholder="Approve the BRD before engineering starts?"
                disabled={readOnly}
                onChange={(e) => onChange(patch(node, { prompt: e.target.value || undefined }))}
              />
            </FieldShell>
          </>
        )}

        {node.kind === "goal_handoff" && (
          <>
            <FieldShell label="Goal title" htmlFor="goal-title" hint="Supports tokens like {{input}}.">
              <TextInput
                id="goal-title"
                value={node.config.titleTemplate}
                placeholder="{{input}}"
                disabled={readOnly}
                onChange={(e) => onChange(patch(node, { titleTemplate: e.target.value }))}
              />
            </FieldShell>
            <FieldShell label="Tasks from" htmlFor="goal-tasks-from" hint="Where the goal's tasks come from.">
              <select
                id="goal-tasks-from"
                className={SELECT_CLASS}
                value={node.config.tasksFrom}
                disabled={readOnly}
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
                  disabled={readOnly}
                  onChange={(e) => onChange(patch(node, { tasksTemplate: e.target.value || undefined }))}
                />
              </FieldShell>
            )}
          </>
        )}

        {node.kind === "output" && (
          <>
            <FieldShell
              label="Format"
              htmlFor="output-format"
              hint="The agent feeding this node is told to produce its output in this format."
            >
              <select
                id="output-format"
                className={SELECT_CLASS}
                value={node.config.format}
                disabled={readOnly}
                onChange={(e) => onChange(patch(node, { format: e.target.value }))}
              >
                <option value="markdown">Markdown</option>
                <option value="text">Plain text</option>
                <option value="table">Table (Markdown)</option>
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
              </select>
            </FieldShell>
            <FieldShell
              label="Format details"
              htmlFor="output-instructions"
              hint="Optional. Describe the exact shape, e.g. a table with columns Name | URL | Status."
            >
              <TextArea
                id="output-instructions"
                rows={4}
                value={node.config.instructions ?? ""}
                placeholder="A table with columns: Topic | Note"
                disabled={readOnly}
                onChange={(e) => onChange(patch(node, { instructions: e.target.value || undefined }))}
              />
            </FieldShell>
            <FieldShell
              label="Output path"
              htmlFor="output-path"
              hint="Where the formatted file is written. Defaults to the upstream agent's path."
            >
              <TextInput
                id="output-path"
                value={node.config.outputPath ?? ""}
                placeholder="workflows/{{workflow_run_id}}/report.md"
                disabled={readOnly}
                onChange={(e) => onChange(patch(node, { outputPath: e.target.value || undefined }))}
              />
            </FieldShell>
          </>
        )}
      </div>
    </div>
  );
}
