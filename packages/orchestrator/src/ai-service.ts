import { generateText, tool, type ModelMessage, type ToolSet } from 'ai';
import { z } from 'zod';
import { buildAgentSystemPrompt, type AgentTeamHandle, type ProviderKind } from '@ujima/framework';
import { selectLanguageModel } from '@ujima/llm';
import type { Message } from '@ujima/shared';
import type { RepositoryReader } from './services/repository-reader.js';
import type { TeamStore } from './services/team-store.js';
import type { ToolService } from './services/tool-service.js';
import { ORCHESTRATOR_TOOLS } from './tools/index.js';


const GenericToolInvocationSchema = z.object({
  action: z.enum(['read', 'write', 'execute', 'mcp', 'message']),
  resourceType: z.enum(['file', 'folder', 'shell', 'mcp', 'message']),
  resourcePath: z.string().min(1).optional(),
  input: z.record(z.string(), z.unknown()).default({}),
});

const SUPPORTED_PROVIDER_KINDS: ReadonlySet<ProviderKind> = new Set([
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ollama',
]);

function resolveProviderKind(
  providerName: string,
  declared: ProviderKind | undefined,
): ProviderKind {
  if (declared) return declared;
  // Back-compat: fall back to the team's provider map key when `kind` isn't
  // declared on `ProviderConfig`. Only works for the three legacy names.
  if (providerName === 'openai' || providerName === 'anthropic' || providerName === 'google') {
    return providerName;
  }
  throw new Error(
    `Provider "${providerName}" has no \`kind\` declared. Add \`kind: 'anthropic'|'openai'|'google'|'openrouter'|'ollama'\` to the provider config.`,
  );
}

function toModelMessages(messages: Message[]): ModelMessage[] {
  return messages.map((message) => ({
    role:
      message.kind === 'system'
        ? 'system'
        : message.senderKind === 'agent'
          ? 'assistant'
          : 'user',
    content: message.content,
  }));
}

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
    const team = this.requireTeam();
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

    if (!role.provider) {
      throw new Error(`Role "${role.name}" is missing a provider`);
    }

    const provider = team.getProvider(role.provider);
    if (!provider) {
      throw new Error(`Provider not found: ${role.provider}`);
    }

    const modelId = role.model ?? provider.defaultModel;
    if (!modelId) {
      throw new Error(`Role "${role.name}" is missing a model`);
    }

    const apiKey = this.repo.getProviderCredential(input.organizationId, role.provider);
    if (!apiKey) {
      throw new Error(`Provider key missing for "${role.provider}"`);
    }

    const kind = resolveProviderKind(role.provider, provider.kind);
    if (!SUPPORTED_PROVIDER_KINDS.has(kind)) {
      throw new Error(`Unsupported provider kind "${kind}"`);
    }
    const model = selectLanguageModel({
      kind,
      modelId,
      apiKey,
      baseUrl: provider.baseUrl,
    });

    const toolDefs = Object.fromEntries(
      role.tools.map((toolId) => [toolId, this.buildToolDefinition(input, toolId, team)]),
    ) as ToolSet;

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
      this.repo.listMessages(input.organizationId, input.threadId).data,
    );
    if (input.summary) {
      messages.push({
        role: 'user',
        content: input.summary,
      });
    }

    return generateText({
      model,
      system,
      messages,
      tools: toolDefs,
      maxOutputTokens: 1200,
      temperature: 0.2,
    });
  }

  private requireTeam() {
    const team = this.teamStore.getTeam();
    if (!team) {
      throw new Error('Team config not loaded');
    }

    return team;
  }

  private buildToolDefinition(
    input: GenerateRunReplyInput,
    toolId: string,
    team: AgentTeamHandle,
  ) {
    const t = ORCHESTRATOR_TOOLS[toolId];
    if (t) {
      return tool({
        description: team.tools[toolId]?.description,
        inputSchema: t.schema,
        execute: async (args, { toolCallId }) => {
          const invocationData = t.toInvocation(args);
          return this.tools.invoke({
            organizationId: input.organizationId,
            runId: input.runId,
            memberId: input.agentId,
            threadId: input.threadId,
            toolCallId,
            toolId,
            ...invocationData,
          });
        },
      });
    }

    // Fallback for tools not natively implemented via ORCHESTRATOR_TOOLS (e.g. mcp)
    return tool({
      description: team.tools[toolId]?.description,
      inputSchema: GenericToolInvocationSchema,
      execute: async (args, { toolCallId }) =>
        this.tools.invoke({
          organizationId: input.organizationId,
          runId: input.runId,
          memberId: input.agentId,
          threadId: input.threadId,
          toolCallId,
          toolId,
          action: args.action,
          resourceType: args.resourceType,
          resourcePath: args.resourcePath,
          input: args.input,
        }),
    });
  }
}
