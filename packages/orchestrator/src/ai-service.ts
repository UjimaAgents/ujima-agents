import { isLoopFinished, type ToolSet } from 'ai';
import { buildAgentSystemPrompt, normalizeProviderKey } from '@ujima/framework';
import type { Message, SpiritRole } from '@ujima/shared';
import { DEFAULT_SPIRIT_TEMPERATURE } from '@ujima/shared';
import { runAgentLoop } from './services/agent-loop.js';
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
import { buildRunTranscript } from './utils/run-transcript.js';
import {
  createMessageCursor,
  isMessageAfterCursor,
  moveCursor,
  type MessageCursor,
} from './utils/message-interrupts.js';


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
  systemPromptSuffix?: string;
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
  ): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
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

    const initialThreadMessages = this.repo.listMessages(input.organizationId, input.threadId, undefined, 20).data;
    const messages = toModelMessages(initialThreadMessages, input.agentId);
    const interruptCursor = createMessageCursor(initialThreadMessages);
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

    const systemPrompt = input.systemPromptSuffix ? `${system}\n\n${input.systemPromptSuffix}` : system;

    return runAgentLoop({
      model,
      system: systemPrompt,
      messages,
      tools: toolDefs,
      stopWhen: isLoopFinished(),
      maxOutputTokens: 1200,
      temperature: DEFAULT_SPIRIT_TEMPERATURE,
      abortSignal: input.abortSignal,
      loadInterruptMessages: () => {
        const interrupts = this.loadRunInterrupts(input, interruptCursor);
        return toModelMessages(interrupts, input.agentId);
      },
    });
  }

  private loadRunInterrupts(
    input: Pick<GenerateRunReplyInput, 'organizationId' | 'agentId' | 'threadId'>,
    cursor: MessageCursor,
  ): Message[] {
    const page = this.repo.listMessages(input.organizationId, input.threadId, undefined, 100).data;
    const interrupts = page.filter(
      (message) =>
        message.kind === 'human' &&
        message.senderId !== input.agentId &&
        isMessageAfterCursor(message, cursor),
    );
    const latest = page.at(-1);
    if (latest) {
      moveCursor(cursor, latest);
    }
    return interrupts;
  }
}
