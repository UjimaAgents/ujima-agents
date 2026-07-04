import { type ToolSet } from 'ai';
import {
  AGENT_KIND,
  type SpiritRole,
  type WakeReason,
} from '@ujima/shared';
import type { AgentTeamHandle } from '@ujima/framework';
import { buildToolDefinitions } from '../utils/to-model-messages.js';
import {
  ALWAYS_AVAILABLE_AGENT_TOOLS,
  SUPERVISOR_TOOL_ALLOWLIST,
  filterDeprecatedToolIds,
} from '../tools/index.js';
import {
  filterToolsForWakeReplyPolicy,
  isAgentOnlyDmThread,
  resolveWakeReplyPolicy,
} from '../utils/wake-reply-policy.js';
import { isDelegateMessage } from './run-reply-guard.js';
import {
  filterDelegateTurnToolSet,
  getDelegateKind,
} from '../utils/delegate-turn.js';
import { isMcpDispatchEnabled } from './feature-flags.js';
import { buildMcpToolDefinitionsV2 } from './connector-spawn-v2.js';
import type { ApiRepository } from './repository-reader.js';
import type { McpServerSummary } from './spirit-mcp-helpers.js';
import type { SpiritMcpPool } from './spirit-types.js';
import type { ToolService } from './tool-service.js';

/** Callback type for the legacy MCP tool definition builder. */
export type McpToolDefinitionsBuilder = (ctx: {
  organizationId: string;
  memberId: string;
  runId: string;
  threadId: string;
  taskSessionId: string;
  role: SpiritRole;
}) => Promise<{ toolSet: ToolSet; servers: McpServerSummary[] }>;

export interface ToolPaletteBuilderDeps {
  repo: ApiRepository;
  tools: ToolService;
  mcpPool?: SpiritMcpPool | null;
  attachmentApprovalRequester?: unknown;
  attachmentCapture?: unknown;
  /** Delegate for the legacy MCP tool definition path. */
  buildMcpToolDefinitions: McpToolDefinitionsBuilder;
}

/**
 * Builds tool palettes for agent runs — resolves built-in tools, MCP tools,
 * wake-reply policy filtering, and delegate turn filtering.
 */
export class ToolPaletteBuilder {
  constructor(private readonly deps: ToolPaletteBuilderDeps) {}

  resolveToolAllowlist(
    roleTools: readonly string[],
    role: SpiritRole,
    override: readonly string[] | undefined,
  ): readonly string[] {
    if (override) return override;
    if (role === 'supervisor') {
      return SUPERVISOR_TOOL_ALLOWLIST;
    }
    return filterDeprecatedToolIds([
      ...new Set([...roleTools, ...ALWAYS_AVAILABLE_AGENT_TOOLS]),
    ]);
  }

  buildToolDefinitions(
    toolIds: readonly string[],
    ctx: {
      organizationId: string;
      runId: string;
      memberId: string;
      threadId: string;
      taskSessionId: string;
      spiritRole: SpiritRole;
      team: AgentTeamHandle;
      repo?: ApiRepository;
    },
  ): ToolSet {
    return buildToolDefinitions(toolIds, ctx.team, this.deps.tools, ctx);
  }

  async buildWakeToolPalette(params: {
    organizationId: string;
    memberId: string;
    runId: string;
    threadId: string;
    sourceMessage: Parameters<typeof isDelegateMessage>[0] | null;
    wakeReason: WakeReason | null;
    roleToolIds: readonly string[];
    team: AgentTeamHandle;
    taskSessionId: string;
    role: SpiritRole;
  }): Promise<{
    toolDefs: ToolSet;
    attachedMcpServers: McpServerSummary[];
    availableConnectors: string | undefined;
    wakeReplyPolicy: ReturnType<typeof resolveWakeReplyPolicy>;
  }> {
    const isDelegate = isDelegateMessage(params.sourceMessage);
    const wakeReplyPolicy = resolveWakeReplyPolicy({
      threadId: params.threadId,
      wakeReason: params.wakeReason,
      dmPeerIsAgent: isAgentOnlyDmThread(
        params.threadId,
        (memberId) => this.deps.repo.getMember(params.organizationId, memberId)?.kind === AGENT_KIND,
      ),
    });
    const baseAlwaysAvailable = filterToolsForWakeReplyPolicy(ALWAYS_AVAILABLE_AGENT_TOOLS, wakeReplyPolicy);
    const filteredRoleTools = filterToolsForWakeReplyPolicy(params.roleToolIds, wakeReplyPolicy);
    const builtInToolDefs = buildToolDefinitions(
      filterDeprecatedToolIds([...new Set([...filteredRoleTools, ...baseAlwaysAvailable])]),
      params.team,
      this.deps.tools,
      {
        organizationId: params.organizationId,
        runId: params.runId,
        memberId: params.memberId,
        threadId: params.threadId,
        repo: this.deps.repo,
      },
    ) as ToolSet;

    const mcpRes = await this.buildMcpToolDefinitionsRouted({
      organizationId: params.organizationId,
      memberId: params.memberId,
      runId: params.runId,
      threadId: params.threadId,
      taskSessionId: params.taskSessionId,
      role: params.role,
    });

    const toolDefs: ToolSet = isDelegate
      ? filterDelegateTurnToolSet({ ...builtInToolDefs, ...mcpRes.toolSet }, getDelegateKind(params.sourceMessage))
      : { ...builtInToolDefs, ...mcpRes.toolSet };

    return { toolDefs, attachedMcpServers: mcpRes.servers, availableConnectors: mcpRes.catalogText, wakeReplyPolicy };
  }

  async buildMcpToolDefinitionsRouted(ctx: {
    organizationId: string;
    memberId: string;
    runId: string;
    threadId: string;
    taskSessionId: string;
    role: SpiritRole;
  }): Promise<{ toolSet: ToolSet; servers: McpServerSummary[]; catalogText?: string }> {
    if (isMcpDispatchEnabled(ctx.organizationId) && this.deps.mcpPool) {
      const v2 = await buildMcpToolDefinitionsV2(
        {
          mcpPool: this.deps.mcpPool,
          repo: this.deps.repo,
          tools: this.deps.tools,
          approvals: this.deps.attachmentApprovalRequester
            ? { requestAttachmentApproval: this.deps.attachmentApprovalRequester as (...args: never[]) => unknown }
            : undefined,
          attachmentCapture: this.deps.attachmentCapture as (...args: never[]) => unknown ?? undefined,
        },
        ctx,
      );
      return {
        toolSet: v2.toolSet,
        servers: v2.servers,
        catalogText: v2.catalogText.length > 0 ? v2.catalogText : undefined,
      };
    }
    return this.deps.buildMcpToolDefinitions(ctx);
  }
}
