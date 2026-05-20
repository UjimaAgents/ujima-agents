import { isLoopFinished, type ToolSet } from 'ai';
import { buildAgentSystemPrompt, normalizeProviderKey } from '@ujima/framework';
import { DEFAULT_SPIRIT_TEMPERATURE, type Message, type SpiritRole } from '@ujima/shared';
import { runAgentLoop, type AgentLoopChunk } from './services/agent-loop.js';
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
import { buildThreadStateBlock } from './utils/thread-state.js';
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
  onChunk?: (chunk: AgentLoopChunk) => PromiseLike<void> | void;
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
}) => Promise<{ toolSet: ToolSet; servers: ResolvedMcpServerSummary[] }>;

export class AiService {
  private mcpToolResolver?: McpToolResolver;

  constructor(
    private readonly teamStore: TeamStore,
    private readonly repo: RepositoryReader,
    private readonly tools: ToolService,
  ) {}

  /**
   * Plug in the MCP tool palette resolver. Production wiring sets this
   * to `spirits.buildMcpToolDefinitions.bind(spirits)` after both
   * services exist (see services/index.ts).
   */
  setMcpToolResolver(resolver: McpToolResolver | undefined): void {
    this.mcpToolResolver = resolver;
  }

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
      // `member.model` is provider-specific to the agent's preferred
      // provider. When `resolveSpiritModel` falls back to a different
      // provider (e.g. the preferred one has no key), that override
      // almost certainly isn't a valid id on the new provider —
      // ignore it on fallback and let the provider/default chain
      // resolve a usable id. The same rule applies to `r.model`,
      // which `resolveSpiritModel` already clears on fallback.
      resolveModelId: (r, p, _role, isFallback) =>
        (isFallback ? undefined : member.model) ?? r.model ?? p.defaultModel,
    });

    // Mandatory-reply enforcement at the tool-palette layer.
    // When wakeReason === 'mention' (the agent was @mentioned, or
    // included via @all expansion), `channel.pass` and `self.note`
    // are stripped so the model literally cannot opt out of
    // replying. Posting tools (`channel.reply`, `channel.post`,
    // `channel.dm`, `message`) stay available via
    // `ALWAYS_AVAILABLE_AGENT_TOOLS`, so the model has a clear
    // path to comply with the "you must reply" contract regardless
    // of how the role config declares its `tools`.
    const wakeReasonForPalette = (this.repo.getRun?.(input.organizationId, input.runId)
      ?.wakeReason ?? null) as string | null;
    const mandatoryReplyMode = wakeReasonForPalette === 'mention';
    const baseAlwaysAvailable = mandatoryReplyMode
      ? ALWAYS_AVAILABLE_AGENT_TOOLS.filter(
          (toolId) => toolId !== 'channel.pass' && toolId !== 'self.note',
        )
      : ALWAYS_AVAILABLE_AGENT_TOOLS;
    const roleTools = mandatoryReplyMode
      ? role.tools.filter((toolId) => toolId !== 'channel.pass' && toolId !== 'self.note')
      : role.tools;
    const toolIds = [...new Set([...roleTools, ...baseAlwaysAvailable])];
    const builtInToolDefs = buildToolDefinitions(toolIds, team, this.tools, {
      organizationId: input.organizationId,
      runId: input.runId,
      memberId: input.agentId,
      threadId: input.threadId,
      repo: this.repo,
    }) as ToolSet;

    // Attached MCPs layer on top of the built-in palette so wake-run
    // agents (this code path) get the same tools that the spirit-run
    // path has been getting all along. Without this, a member with a
    // Playwright MCP attached wakes via @mention and the model sees
    // only channel.* tools, so it (correctly) tells the user it has
    // no Playwright tool. The resolver is late-bound at startup.
    // Resolve the SpiritRole this wake actually belongs to. Without
    // this, the resolver defaults to `'worker'` and any MCP attachment
    // scoped `'supervisor'`-only would be silently invisible to the
    // model — and `ToolServiceImpl.executeMcpTool` (which re-reads
    // attachments by role at invocation time) would reject the call
    // even if the model tried. Look up any live spirit for this
    // member; prefer one that matches the current run, otherwise fall
    // back to whatever active spirit the member has. Default to
    // `'worker'` when no spirit exists (the regular wake-run path).
    let resolvedRole: SpiritRole = 'worker';
    let resolvedTaskSessionId = '';
    if (this.repo.listActiveSpiritsForMember) {
      const activeSpirits = this.repo.listActiveSpiritsForMember(
        input.organizationId,
        input.agentId,
      );
      const matchingSpirit =
        activeSpirits.find((spirit) => spirit.runId === input.runId) ??
        activeSpirits[0];
      if (matchingSpirit) {
        resolvedRole = matchingSpirit.role;
        resolvedTaskSessionId = matchingSpirit.taskSessionId;
      }
    }

    const mcpResolution = this.mcpToolResolver
      ? await this.mcpToolResolver({
          organizationId: input.organizationId,
          memberId: input.agentId,
          runId: input.runId,
          threadId: input.threadId,
          // Preserve the task session id so MCP tools that need one
          // (audit linkage, per-task isolation) still get it. Empty
          // string when there's no active spirit/task — the value is
          // only used by tool runtime code that already handles the
          // bare-wake case.
          taskSessionId: resolvedTaskSessionId,
          role: resolvedRole,
        })
      : { toolSet: {} as ToolSet, servers: [] };
    const mcpToolDefs = mcpResolution.toolSet;
    const attachedMcpServers = mcpResolution.servers;
    const toolDefs: ToolSet = { ...builtInToolDefs, ...mcpToolDefs };

    // The "Available tools:" line in the system prompt is what some
    // models actually read when deciding whether they CAN call a tool.
    // Pass the FULL resolved palette (baseline + role + MCP namespaced
    // ids) so the prompt matches the AI-SDK schema; otherwise the
    // model can deny tools it actually has.
    const availableToolIds = Object.keys(toolDefs);
    const system = buildAgentSystemPrompt(
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
      team.channels,
      organization.organizationChart,
      availableToolIds,
      attachedMcpServers.map((s) => ({ name: s.serverName, toolNames: s.toolNames })),
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

    // Factual thread-state injection. Gives the model ground truth
    // about who was addressed, who already responded, and how it sits
    // in the channel — instead of letting it invent claims like
    // "already handled" or "addressed to someone else." Provider-
    // agnostic (XML wrapper, works on Claude / DeepSeek / GPT / Gemini).
    // Resolved from the wake's sourceMessageId when available so the
    // "responders since wake" computation is correct on long threads.
    const runRow = this.repo.getRun?.(input.organizationId, input.runId);
    const sourceMessageId = (runRow?.sourceMessageId ?? undefined) as string | undefined;
    const threadStateBlock = buildThreadStateBlock({
      messages: initialThreadMessages,
      currentMember: { id: member.id, name: member.name },
      sourceMessageId,
      members: this.repo.listMembers(input.organizationId),
    });
    if (threadStateBlock) {
      messages.push({
        role: 'user',
        content: threadStateBlock,
      });
    }

    // Provider-agnostic decision scaffold — positive-framed, no
    // forbidden-phrase list (negation anchoring is a known trap)
    // and no use of the word "silence" as a noun (the model will
    // paraphrase it back as message content). Points the model at
    // the <thread-state> block above so it grounds its decision in
    // facts instead of inventing them.
    const wakeRunScaffold = [
      'Before you pick a tool, read the <thread-state> block in the most recent user message.',
      'Treat its <agents-not-yet-responded> and <you-explicitly-addressed> / <you-implicitly-addressed> fields as ground truth — they are computed from the actual channel state, not from your reading.',
      'If <you-explicitly-addressed>true</you-explicitly-addressed>, you must reply via a posting tool.',
      'If <you-explicitly-addressed>false</you-explicitly-addressed> AND <you-implicitly-addressed>false</you-implicitly-addressed>, call channel.pass and stop. Do not post any message — not a short acknowledgement, not a status update, not a hand-off announcement. The audit log already records that you considered the thread.',
      'When you call channel.pass, the reason must match thread-state facts. Do not write filler in the note field.',
    ].join('\n');
    const goalSuffix = input.systemPromptSuffix;
    const combinedSuffix = [goalSuffix, wakeRunScaffold].filter(Boolean).join('\n\n');
    const systemPrompt = combinedSuffix ? `${system}\n\n${combinedSuffix}` : system;

    return runAgentLoop({
      model,
      system: systemPrompt,
      messages,
      tools: toolDefs,
      stopWhen: isLoopFinished(),
      maxOutputTokens: 1200,
      // Lower temperature for mandatory mention wakes: at 0.2 the model is
      // more willing to commit to a structured posting tool. Other runs keep
      // the shared default.
      temperature: mandatoryReplyMode ? 0.2 : DEFAULT_SPIRIT_TEMPERATURE,
      // L1/L2: force a tool call on the FIRST step only so the model
      // picks `channel.pass` or a posting tool fast. Continuation
      // steps go back to `auto` so multi-step read→write→reply
      // sequences still work.
      toolChoice: 'required-first-step',
      abortSignal: input.abortSignal,
      onChunk: input.onChunk,
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
