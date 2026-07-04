import type { AgentDef, TaskDef } from '@ujima/shared';
import { generateText, streamText, type LanguageModel } from 'ai';

export interface PlanAssignment {
  agentId: string;
  subprompt: string;
  reason?: string;
  dependsOn?: string[];
}

export interface PlanResult {
  assignments: PlanAssignment[];
  rawText: string;
  warnings: string[];
}

export interface PlanInputs {
  task: TaskDef;
  agents: AgentDef[];
  model: LanguageModel;
  abortSignal?: AbortSignal;
}

export async function planAssignments(input: PlanInputs): Promise<PlanResult> {
  const { task, agents, model, abortSignal } = input;
  const warnings: string[] = [];

  const agentBrief = agents
    .map((a) => {
      const tools = a.permissions.allowed_tools.slice(0, 12).join(', ') || '(none)';
      const firstLine = a.persona.split('\n')[0]?.slice(0, 200) ?? '';
      return `- id: ${a.id}\n  name: ${a.name}\n  mcp: ${a.mcp}\n  seniority: ${a.seniority}\n  tools: ${tools}\n  persona: ${firstLine}`;
    })
    .join('\n');

  const system = [
    'You are the routing planner for a multi-agent team. Pick the minimum set of agents that can actually deliver the user task, write a concrete subprompt for each one, and declare dependencies between them.',
    '',
    'CRITICAL — dependency ordering:',
    '- Think step-by-step about what order work must happen. If agent B needs information, output, or artifacts from agent A, then B MUST have dependsOn: ["<agentA-id>"].',
    '- Common dependency patterns:',
    '  • research/search → write/build (the writer needs the research results first)',
    '  • design → implement (the implementer needs the design first)',
    '  • schema/plan → code (the coder needs the schema/plan first)',
    '- Agents with NO dependsOn run immediately in parallel. Agents WITH dependsOn wait until ALL listed predecessors finish, then receive their outputs automatically.',
    '- If only one agent is needed, set dependsOn to [] or omit it.',
    '',
    'Other rules:',
    '- Only include agents whose persona, MCP, or tools fit the task. Never include an agent "just in case".',
    '- Each subprompt must be a direct, actionable instruction to that specific agent (not a restatement of the whole task).',
    '- Tell each agent to write output files inside the current workspace directory, never to absolute paths like ~/Downloads.',
    '- If no agent fits, return an empty assignments array.',
    '- Respond with a single JSON object and nothing else (no prose, no markdown fences).',
    '- Shape: {"assignments":[{"agentId":"...","subprompt":"...","reason":"...","dependsOn":["..."]}]}',
  ].join('\n');

  const user = [
    `User task: ${task.prompt}`,
    '',
    `Available agents:`,
    agentBrief,
    '',
    'Return the routing JSON now.',
  ].join('\n');

  const rawText = isCodexResponsesModel(model)
    ? await streamText({
        model,
        system,
        prompt: user,
        abortSignal,
        maxOutputTokens: 8_000,
      }).text
    : (await generateText({
        model,
        system,
        prompt: user,
        abortSignal,
        maxOutputTokens: 8_000,
      })).text;

  const parsed = extractAssignments(rawText);
  if (!parsed) {
    warnings.push('planner returned no parseable JSON');
    return { assignments: [], rawText, warnings };
  }

  const validIds = new Set(agents.map((a) => a.id));
  const assignments: PlanAssignment[] = [];
  for (const raw of parsed) {
    if (typeof raw.agentId !== 'string' || typeof raw.subprompt !== 'string') continue;
    if (!validIds.has(raw.agentId)) {
      warnings.push(`planner picked unknown agent "${raw.agentId}" — dropped`);
      continue;
    }
    const dependsOn = Array.isArray(raw.dependsOn)
      ? (raw.dependsOn as unknown[]).filter((d): d is string => typeof d === 'string' && validIds.has(d))
      : undefined;
    assignments.push({
      agentId: raw.agentId,
      subprompt: raw.subprompt.trim() || task.prompt,
      reason: typeof raw.reason === 'string' ? raw.reason : undefined,
      dependsOn: dependsOn && dependsOn.length > 0 ? dependsOn : undefined,
    });
  }

  return { assignments, rawText, warnings };
}

function isCodexResponsesModel(model: LanguageModel): boolean {
  const meta = model as { provider?: unknown };
  return meta.provider === 'openai.responses';
}

interface RawAssignment {
  agentId?: unknown;
  subprompt?: unknown;
  reason?: unknown;
  dependsOn?: unknown;
}

function extractAssignments(text: string): RawAssignment[] | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  const tryParse = (s: string): RawAssignment[] | undefined => {
    try {
      const parsed: unknown = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed as RawAssignment[];
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { assignments?: unknown }).assignments)) {
        return (parsed as { assignments: RawAssignment[] }).assignments;
      }
      return undefined;
    } catch {
      return undefined;
    }
  };

  const direct = tryParse(trimmed);
  if (direct) return direct;

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence && fence[1]) {
    const fromFence = tryParse(fence[1].trim());
    if (fromFence) return fromFence;
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const fromBraces = tryParse(trimmed.slice(firstBrace, lastBrace + 1));
    if (fromBraces) return fromBraces;
  }

  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const fromBrackets = tryParse(trimmed.slice(firstBracket, lastBracket + 1));
    if (fromBrackets) return fromBrackets;
  }

  return undefined;
}
