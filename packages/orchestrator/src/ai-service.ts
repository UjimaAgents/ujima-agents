import {randomUUID} from "node:crypto";
import {type ToolSet} from "ai";
import {buildAgentSystemPrompt, normalizeProviderKey} from "@ujima/framework";
import {AgentLoopLogger} from "./debug/agent-loop-logger.js";
import {type SpiritRole} from "@ujima/shared";
import {runAgentLoop} from "./services/agent-loop.js";
import type {ApiRepository} from "./services/repository-reader.js";
import type {TeamStore} from "./services/team-store.js";
import type {ToolService} from "./services/tool-service.js";
import {
  toModelMessages,
  resolveSpiritModel,
  buildToolDefinitions,
  makeProviderModelsInUseLookup,
  defaultResolveModelId,
} from "./utils/to-model-messages.js";
import {requireTeam} from "./utils/require-team.js";
import {resolveVisiblePromptChannels} from "./utils/visible-prompt-channels.js";
import {buildCacheableSystem, loadProceduresForSystemPrompt} from "./utils/system-prompt-builder.js";
import {selectPromptContextMessages} from "./utils/prompt-context.js";
import {configureClaudeCodeTools} from "@ujima/llm";

// Resolver now delegates to the canonical `@ujima/llm` surface so every
// AI-SDK-driven code path (this `/api/runs` service, the upcoming
// agent-runtime `ai-sdk-loop`, the conflict referee, the task promoter)
// agrees on the provider kind → model wiring.

export interface GenerateMemoryReviewInput {
  organizationId: string;
  memberId: string;
  threadId: string;
  prompt: string;
  contextSize?: number;
  abortSignal?: AbortSignal;
}

/**
 * Resolves the MCP tool palette for a given (org, member, role). Late-
 * bound via `AiService.setMcpToolResolver` after construction to break
 * the AiService ↔ SpiritService construction cycle — both can't be
 * constructed first, so we wire the resolver post-hoc once both exist.
 * When the resolver is unset, MCP tools simply don't appear in the
 * wake-run palette (legacy behavior).
 */
export interface ResolvedMcpServerSummary {
  serverName: string;
  serverId: string;
  toolNames: string[];
}

export type McpToolResolver = (ctx: {
  organizationId: string;
  memberId: string;
  runId: string;
  threadId: string;
  taskSessionId: string;
  role: SpiritRole;
}) => Promise<{
  toolSet: ToolSet;
  servers: ResolvedMcpServerSummary[];
  /**
   * Pre-rendered V2 dispatch catalog block for the system prompt
   * (mcp_connector_dispatch_plan.md §5.3 / §7.4). Empty / undefined
   * on the legacy spawn so the prompt stays byte-for-byte unchanged
   * for tier-blind orgs.
   *
   * Without this the wake-run path knew about `invoke_connector_tool`
   * but had no way to learn which serverIds were dispatch-attached
   * — agents had to be told the UUID by hand. Threading the catalog
   * here lets the system prompt list them inline (same shape the
   * run-loop entry already does at spirit-agent-run.ts:230).
   */
  catalogText?: string;
}>;

export class AiService {
  private mcpToolResolver?: McpToolResolver;

  constructor(
    private readonly teamStore: TeamStore,
    private readonly repo: ApiRepository,
    private readonly tools: ToolService,
    mcpToolResolver?: McpToolResolver,
  ) {
    this.mcpToolResolver = mcpToolResolver;
  }

  /**
   * Plug in the MCP tool palette resolver. Production wiring sets this
   * to `spirits.buildMcpToolDefinitions.bind(spirits)` after both
   * services exist (see services/index.ts).
   */
  setMcpToolResolver(resolver: McpToolResolver | undefined): void {
    this.mcpToolResolver = resolver;
  }

  async generateMemoryReview(
    input: GenerateMemoryReviewInput
  ): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
    const team = requireTeam(this.teamStore, input.organizationId);
    const organization = this.repo.getOrganization(input.organizationId);
    if (!organization) {
      throw new Error(`Organization not found: ${input.organizationId}`);
    }

    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) {
      throw new Error(`Member not found: ${input.memberId}`);
    }

    const agent = team.getAgent(member.id) ?? team.getAgent(member.name);
    if (!agent) {
      throw new Error(`Agent not found: ${member.id}`);
    }
    const role = team.getRole(agent.roleName);
    if (!role) {
      throw new Error(`Role not found: ${agent.roleName}`);
    }

    const model = await resolveSpiritModel({
      organizationId: input.organizationId,
      memberId: input.memberId,
      role: "worker" as SpiritRole,
      member,
      team,
      getProviderCredential: (orgId, key) =>
        this.repo.getProviderCredential(orgId, key),
      resolveProviderName: (m, r) =>
        normalizeProviderKey(m.llm ?? r.provider ?? ""),
      // Reuse the shared resolver so the member→role→default ladder (and
      // the fallback's member-model drop) stays identical to every other
      // call site — an inline copy previously drifted and leaked a
      // cross-provider model onto the fallback.
      resolveModelId: defaultResolveModelId,
      listConfiguredProviders: () =>
        this.repo.listProviderCredentials(input.organizationId),
      listProviderModelsInUse: makeProviderModelsInUseLookup(
        this.repo,
        input.organizationId
      ),
    });

    const reviewToolIds = [
      "memory.write",
      "memory.recall",
      "memory.forget",
      "procedure",
    ] as const;
    const runId = `memory-review:${randomUUID()}`;
    const toolDefs = buildToolDefinitions(reviewToolIds, team, this.tools, {
      organizationId: input.organizationId,
      runId,
      memberId: input.memberId,
      threadId: input.threadId,
      repo: this.repo,
    }) as ToolSet;

    const availableSkills =
      this.repo.listOrganizationSkillInstalls?.(input.organizationId) ?? [];
    const baseSystemPrompt = buildAgentSystemPrompt(
      team.workspace.root,
      organization.name,
      member.id,
      member.name,
      input.threadId,
      agent,
      role,
      this.repo
        .listMembers(input.organizationId)
        .filter((current) => current.id !== member.id),
      team.agents,
      resolveVisiblePromptChannels(
        team.channels,
        this.repo,
        input.organizationId
      ),
      organization.organizationChart,
      availableSkills,
      Object.keys(toolDefs),
      [],
      "channel",
      undefined,
      model
    );

    const proceduresText = await loadProceduresForSystemPrompt(
      team.workspace.root,
      member.id
    );
    const {system} = buildCacheableSystem({
      baseSystem: baseSystemPrompt,
      proceduresText,
      baseScaffold: [
        "This is a silent background memory-review turn.",
        "Use only memory and self.procedure tools. Do not post, DM, reply, or address the user.",
        "If nothing durable is worth saving, output exactly: Nothing to save.",
      ].join("\n"),
      availableToolIds: Object.keys(toolDefs),
    });

    const recentThreadMessages = selectPromptContextMessages(
      this.repo.listMessages(
        input.organizationId,
        input.threadId,
        undefined,
        Math.max(input.contextSize ?? 10, 600)
      ).data,
      input.contextSize ?? 10
    );
    const messages = toModelMessages(recentThreadMessages, input.memberId);
    messages.push({
      role: "user",
      content: input.prompt,
    });

    const memDebugLogger = new AgentLoopLogger();
    memDebugLogger.setContext({
      agentId: input.memberId,
      threadId: input.threadId,
      organizationId: input.organizationId,
      model,
      systemPrompt: system,
      messages,
      tools: toolDefs,
    });
    try {
      const runnableModel = configureClaudeCodeTools(model, async (toolName, args, toolCallId) => {
        const definition = toolDefs[toolName] as {
          execute?: (input: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>;
        } | undefined;
        if (!definition?.execute) return { error: `Tool not found: ${toolName}` };
        return definition.execute(args, {
          toolCallId,
          abortSignal: input.abortSignal,
          messages: [],
        });
      });
      const memResult = await runAgentLoop({
        model: runnableModel,
        system,
        messages,
        tools: toolDefs,
        stopWhen: () => false,
        maxOutputTokens: 800,
        temperature: 0.2,
        toolChoice: "auto",
        abortSignal: input.abortSignal,
      });
      memDebugLogger.setTokenUsage({
        inputTokens: memResult.usage?.inputTokens,
        outputTokens: memResult.usage?.outputTokens,
        totalTokens: memResult.usage?.totalTokens,
      });
      memDebugLogger.flush().catch(() => undefined);
      return memResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      memDebugLogger.setError(message);
      memDebugLogger.flush().catch(() => undefined);
      throw err;
    }
  }

  // generateRunReply removed — moved to SpiritServiceAgentRun
}
