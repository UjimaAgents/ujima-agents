import { generateText, isLoopFinished, type ToolSet } from 'ai';
import { buildAgentSystemPrompt, normalizeProviderKey } from '@ujima/framework';
import type { SpiritRole } from '@ujima/shared';
import { DEFAULT_SPIRIT_TEMPERATURE } from '@ujima/shared';
import type { RepositoryReader } from './services/repository-reader.js';
import type { TeamStore } from './services/team-store.js';
import type { ToolService } from './services/tool-service.js';
import { ALWAYS_AVAILABLE_AGENT_TOOLS } from './tools/index.js';
import {
  toModelMessages,
  resolveSpiritModel,
  buildToolDefinitions,
} from './utils/to-model-messages.js';
import { requireTeam } from './utils/require-team.js';


// Resolver now delegates to the canonical `@ujima/llm` surface so every
// AI-SDK-driven code path (this `/api/runs` service, the upcoming
// agent-runtime `ai-sdk-loop`, the conflict referee, the task promoter)
// agrees on the provider kind → model wiring.

export interface GenerateRunReplyInput {
  organizationId: string;
  agentId: string;
  threadId: string;
  runId: string;
  summary?: string;
  abortSignal?: AbortSignal;
}

export class AiService {
  constructor(
    private readonly teamStore: TeamStore,
    private readonly repo: RepositoryReader,
    private readonly tools: ToolService,
  ) {}

  async generateRunReply(
    input: GenerateRunReplyInput,
  ): Promise<Awaited<ReturnType<typeof generateText>>> {
    const team = requireTeam(this.teamStore);
    const organization = this.repo.getOrganization(input.organizationId);
    if (!organization) {
      throw new Error(`Organization not found: ${input.organizationId}`);
    }

    const member = this.repo.getMember(input.organizationId, input.agentId);
    if (!member) {
      throw new Error(`Member not found: ${input.agentId}`);
    }

    const agent = team.getAgent(member.id) ?? team.getAgent(member.name);
    if (!agent) {
      throw new Error(`Agent not found: ${member.id}`);
    }
    const role = team.getRole(agent.roleName);
    if (!role) {
      throw new Error(`Role not found: ${agent.roleName}`);
    }

    const model = resolveSpiritModel({
      organizationId: input.organizationId,
      memberId: input.agentId,
      role: 'worker' as SpiritRole,
      member,
      team,
      getProviderCredential: (orgId, key) => this.repo.getProviderCredential(orgId, key),
      resolveProviderName: (m, r) => normalizeProviderKey(m.llm ?? r.provider ?? ''),
      resolveModelId: (r, p) => member.model ?? r.model ?? p.defaultModel,
    });

    const toolIds = [...new Set([...role.tools, ...ALWAYS_AVAILABLE_AGENT_TOOLS])];
    const toolDefs = buildToolDefinitions(toolIds, team, this.tools, {
      organizationId: input.organizationId,
      runId: input.runId,
      memberId: input.agentId,
      threadId: input.threadId,
    }) as ToolSet;

    const system = buildAgentSystemPrompt(
      team.workspace.root,
      organization.name,
      member.id,
      input.threadId,
      agent,
      role,
      this.repo
        .listMembers(input.organizationId)
        .filter((current) => current.id !== member.id),
      team.agents,
      team.channels,
      organization.organizationChart,
    );

    const messages = toModelMessages(
      this.repo.listMessages(input.organizationId, input.threadId, undefined, 20).data,
    );
    if (input.summary) {
      messages.push({
        role: 'user',
        content: input.summary,
      });
    }
    const runTranscript = buildRunTranscript(
      this.repo.listRunSteps?.(input.organizationId, input.runId) ?? [],
    );
    if (runTranscript) {
      messages.push({
        role: 'user',
        content: runTranscript,
      });
    }

    return generateText({
      model,
      system,
      messages,
      tools: toolDefs,
      stopWhen: isLoopFinished(),
      maxOutputTokens: 1200,
      temperature: DEFAULT_SPIRIT_TEMPERATURE,
      abortSignal: input.abortSignal,
    });
  }
}

function buildRunTranscript(
  steps: {
    createdAt: string;
    toolId: string;
    action: string;
    resourcePath: string;
    input: Record<string, unknown>;
    output?: unknown;
    status: string;
  }[],
): string {
  if (!steps.length) return '';
  const lines = steps.slice(-20).map((step) => {
    const input = formatStepInput(step.input);
    const output = formatStepOutput(step.output);
    return [
      `- ${step.createdAt}`,
      `Tool: ${step.toolId}.${step.action}`,
      step.resourcePath ? `Resource: ${step.resourcePath}` : '',
      input ? `Input: ${input}` : '',
      `Status: ${step.status}`,
      output ? `Output:\n${output}` : '',
    ].filter(Boolean).join('\n');
  });
  return [
    'Current run transcript from before the approval pause:',
    'Continue from this state. Do not repeat tool calls that already have useful output.',
    lines.join('\n\n'),
  ].join('\n\n');
}

function formatStepInput(input: Record<string, unknown>): string {
  return truncate(JSON.stringify(input));
}

function formatStepOutput(value: unknown): string {
  if (!value || typeof value !== 'object') return String(value ?? '');
  const output = value as { stdout?: unknown; stderr?: unknown };
  const stdout = typeof output.stdout === 'string' ? output.stdout.trim() : '';
  const stderr = typeof output.stderr === 'string' ? output.stderr.trim() : '';
  const text = [stdout ? `stdout:\n${stdout}` : '', stderr ? `stderr:\n${stderr}` : '']
    .filter(Boolean)
    .join('\n');
  return text || truncate(JSON.stringify(value));
}

function truncate(value: string): string {
  return value.length > 4000 ? `${value.slice(0, 4000)}\n[truncated]` : value;
}
