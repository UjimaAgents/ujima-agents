import {
  extractWorkflowTokens,
  type NodeOutput,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeRun,
} from '@ujima/shared';

/**
 * Pure helpers shared by the workflow engine. Everything here is
 * side-effect-free so it can be unit-tested in isolation and reused by both
 * the engine and the tools. The engine owns all I/O (DB, run spawning).
 */

export interface SkillRef {
  skillName: string;
  arguments?: Record<string, unknown>;
}

export interface AttachedSubnodes {
  skills: SkillRef[];
  toolIds: string[];
}

/**
 * Collect the skill/tool sub-nodes attached to an agent node via `ai_skill` /
 * `ai_tool` edges. These become the agent run's preloaded skills + tool
 * allowlist — capabilities the agent may use, not pipeline stages.
 */
export function resolveAttachedSubnodes(
  graph: WorkflowGraph,
  agentNodeId: string,
): AttachedSubnodes {
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const skills: SkillRef[] = [];
  const toolIds: string[] = [];
  for (const edge of graph.edges) {
    if (edge.target !== agentNodeId) continue;
    if (edge.targetPort !== 'ai_skill' && edge.targetPort !== 'ai_tool') continue;
    const src = byId.get(edge.source);
    if (!src) continue;
    if (edge.targetPort === 'ai_skill' && src.kind === 'skill') {
      skills.push({skillName: src.config.skillName, arguments: src.config.arguments});
    } else if (edge.targetPort === 'ai_tool' && src.kind === 'tool') {
      toolIds.push(src.config.toolId);
    }
  }
  return {skills, toolIds};
}

/**
 * Build the envelope map (nodeId -> NodeOutput) from the latest *completed*
 * node run per node. This is what downstream token references read from.
 */
export function buildNodeOutputs(
  nodeRuns: WorkflowNodeRun[],
): Map<string, NodeOutput> {
  const latest = new Map<string, WorkflowNodeRun>();
  for (const nr of nodeRuns) {
    if (nr.status !== 'completed') continue;
    const prev = latest.get(nr.nodeId);
    if (!prev || nr.attempt >= prev.attempt) latest.set(nr.nodeId, nr);
  }
  const out = new Map<string, NodeOutput>();
  for (const [nodeId, nr] of latest) {
    out.set(nodeId, {
      summary: nr.summary ?? '',
      output_file: nr.outputPath ?? undefined,
      json: nr.outputJson,
    });
  }
  return out;
}

export interface TokenContext {
  input: string;
  workflowRunId: string;
  /** The current node's own designated output path (`{{node.output}}`). */
  selfOutput?: string;
  outputs: Map<string, NodeOutput>;
}

/** Substitute every recognized `{{ ... }}` token. Unknown tokens are left. */
export function resolveTokens(text: string, ctx: TokenContext): string {
  let result = text;
  for (const {raw, token} of extractWorkflowTokens(text)) {
    if (!token) continue;
    let value = '';
    switch (token.kind) {
      case 'input':
        value = ctx.input;
        break;
      case 'workflow_run_id':
        value = ctx.workflowRunId;
        break;
      case 'self_output':
        value = ctx.selfOutput ?? '';
        break;
      case 'node': {
        const out = ctx.outputs.get(token.nodeId);
        if (token.field === 'output') value = out?.output_file ?? '';
        else if (token.field === 'summary') value = out?.summary ?? '';
        else value = JSON.stringify(out?.json ?? null);
        break;
      }
    }
    result = result.split(raw).join(value);
  }
  return result;
}

/** The default output path for an agent node when none is configured. */
export function defaultAgentOutputPath(
  workflowRunId: string,
  nodeId: string,
): string {
  return `workflows/${workflowRunId}/${nodeId}.md`;
}

/**
 * The wake-context block injected into an agent node's system prompt. Tells
 * the agent it is a workflow step, where to save its document, and that the
 * only legal terminator is `workflow.advance`.
 */
export function buildWorkflowWakeContext(input: {
  workflowName: string;
  workflowRunId: string;
  nodeId: string;
  nodeLabel?: string;
  outputPath: string;
}): string {
  const label = input.nodeLabel ? ` ("${input.nodeLabel}")` : '';
  return [
    `## Workflow context`,
    `You are node \`${input.nodeId}\`${label} of workflow "${input.workflowName}" (run \`${input.workflowRunId}\`).`,
    `**You own this step. Do the work yourself right now — do not delegate it, reassign it to another agent, decline it, or say it belongs to someone else's lane.** The workflow assigned this step to you deliberately.`,
    `Produce your document and save it to \`${input.outputPath}\` using the \`write\` tool (it creates directories automatically; do not use \`shell\`).`,
    `When the file is written, call \`workflow.advance\` with a one-line summary (and structured \`json\` if the next step needs it). Do not call \`channel.close\` before you have written the file and advanced.`,
    `The handoff tools \`goal.start\`, \`channel.pass\`, and \`channel.handoff\` are unavailable during this run — your only handoff is \`workflow.advance\`.`,
  ].join('\n');
}

export interface GoalHandoffResult {
  title: string;
  tasks: unknown[];
}

/**
 * Resolve a goal_handoff node's title + tasks from upstream envelopes.
 * `tasksFrom: 'json'` pulls a tasks array from the nearest upstream node's
 * structured json; `template` renders + parses `tasksTemplate`.
 */
export function resolveGoalHandoff(
  node: Extract<WorkflowNode, {kind: 'goal_handoff'}>,
  ctx: TokenContext,
): GoalHandoffResult {
  const title = resolveTokens(node.config.titleTemplate, ctx);
  let tasks: unknown[] = [];
  if (node.config.tasksFrom === 'template' && node.config.tasksTemplate) {
    try {
      const parsed = JSON.parse(resolveTokens(node.config.tasksTemplate, ctx));
      if (Array.isArray(parsed)) tasks = parsed;
    } catch {
      tasks = [];
    }
  } else {
    // Pull a `tasks` array from the most recent upstream json payload.
    for (const out of ctx.outputs.values()) {
      const json = out.json as {tasks?: unknown} | undefined;
      if (json && Array.isArray(json.tasks)) tasks = json.tasks;
    }
  }
  return {title, tasks};
}
