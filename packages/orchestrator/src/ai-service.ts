import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { z } from 'zod';
import { buildAgentSystemPrompt, type AgentTeamHandle } from '@ujima/framework';
import type { Message } from '@ujima/shared';
import type { RepositoryReader } from './services/repository-reader.js';
import type { TeamStore } from './services/team-store.js';
import type { ToolService } from './services/tool-service.js';

const FilesystemToolInvocationSchema = z.object({
  action: z.enum(['read', 'write']),
  resourcePath: z.string().min(1),
  content: z.string().optional(),
});

const ShellToolInvocationSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
});

const MessageToolInvocationSchema = z.discriminatedUnion('destination', [
  z.object({
    destination: z.literal('thread'),
    content: z.string().min(1),
    mentions: z.array(z.string().min(1)).default([]),
  }),
  z.object({
    destination: z.literal('channel'),
    channelId: z.string().min(1),
    content: z.string().min(1),
    mentions: z.array(z.string().min(1)).default([]),
  }),
  z.object({
    destination: z.literal('dm'),
    recipientId: z.string().min(1),
    content: z.string().min(1),
    mentions: z.array(z.string().min(1)).default([]),
  }),
]);

const GenericToolInvocationSchema = z.object({
  action: z.enum(['read', 'write', 'execute', 'mcp', 'message']),
  resourceType: z.enum(['file', 'folder', 'shell', 'mcp', 'message']),
  resourcePath: z.string().min(1).optional(),
  input: z.record(z.string(), z.unknown()).default({}),
});

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

function resolveModel(providerName: string, apiKey: string, modelId: string): LanguageModel {
  if (providerName === 'openai') {
    return createOpenAI({ apiKey }).responses(modelId as never);
  }

  if (providerName === 'anthropic') {
    return createAnthropic({ apiKey }).messages(modelId as never);
  }

  if (providerName === 'google') {
    return createGoogleGenerativeAI({ apiKey }).languageModel(modelId as never);
  }

  throw new Error(`Unsupported provider "${providerName}"`);
}

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

    const model = resolveModel(role.provider, apiKey, modelId);

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
    if (toolId === 'filesystem') {
      return tool({
        description: team.tools[toolId]?.description,
        inputSchema: FilesystemToolInvocationSchema,
        execute: async (args, { toolCallId }) =>
          this.tools.invoke({
            organizationId: input.organizationId,
            runId: input.runId,
            memberId: input.agentId,
            threadId: input.threadId,
            toolCallId,
            toolId,
            action: args.action,
            resourceType: 'file',
            resourcePath: args.resourcePath,
            input: { content: args.content },
          }),
      });
    }

    if (toolId === 'shell') {
      return tool({
        description: team.tools[toolId]?.description,
        inputSchema: ShellToolInvocationSchema,
        execute: async (args, { toolCallId }) =>
          this.tools.invoke({
            organizationId: input.organizationId,
            runId: input.runId,
            memberId: input.agentId,
            threadId: input.threadId,
            toolCallId,
            toolId,
            action: 'execute',
            resourceType: 'shell',
            input: { command: args.command, args: args.args },
          }),
      });
    }

    if (toolId === 'message') {
      return tool({
        description: team.tools[toolId]?.description,
        inputSchema: MessageToolInvocationSchema,
        execute: async (args, { toolCallId }) =>
          this.tools.invoke({
            organizationId: input.organizationId,
            runId: input.runId,
            memberId: input.agentId,
            toolCallId,
            toolId,
            action: 'message',
            resourceType: 'message',
            threadId: input.threadId,
            input: args,
          }),
      });
    }

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
