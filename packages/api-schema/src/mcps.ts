import { z } from 'zod';
import {
  AgentMcpAttachmentSchema,
  ChannelMcpAttachmentSchema,
  GovernancePolicy,
  IdSchema,
  McpAttachmentScopeSchema,
  McpAttachmentTierSchema,
  McpIsolationSchema,
  McpServerPublicSchema,
  McpToolDescriptorSchema,
  McpTransportSchema,
  RiskDefaultsSchema,
  TierCurationSuggestionSchema,
  ToolPolicyState,
  ToolRiskClass,
} from '@ujima/shared';

// REST shapes for the MCP registry (Phase 3 of the MCP integration).
// All response shapes use `McpServerPublic` — the redacted variant that
// strips key_refs and surfaces only `hasEnv` / `hasHeaders` + key
// NAMES. Secret values never appear on the wire.

const Categories = z.string().min(1).max(64);
const SecretMap = z.record(z.string().min(1), z.string()).optional();

const SharedServerFields = {
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  category: Categories.optional(),
  isolation: McpIsolationSchema.optional(),
};

export const CreateMcpServerRequestSchema = z.object({
  organizationId: IdSchema,
  createdBy: IdSchema,
  ...SharedServerFields,
  transport: McpTransportSchema,
  command: z.string().min(1).max(2000).optional(),
  args: z.array(z.string()).max(64).optional(),
  env: SecretMap,
  url: z.string().min(1).max(2000).optional(),
  headers: SecretMap,
});

export const UpdateMcpServerRequestSchema = z.object({
  organizationId: IdSchema,
  name: SharedServerFields.name.optional(),
  description: SharedServerFields.description,
  category: SharedServerFields.category,
  isolation: SharedServerFields.isolation,
  command: z.string().min(1).max(2000).optional(),
  args: z.array(z.string()).max(64).optional(),
  /**
   * Setting `env: null` clears the stored env. Omitting the field
   * leaves it unchanged. Same semantics for `headers`. The OpenAPI
   * representation surfaces this distinction so clients can do a
   * three-state update (set / clear / leave).
   */
  env: z.union([SecretMap.unwrap(), z.null()]).optional(),
  url: z.string().min(1).max(2000).optional(),
  headers: z.union([SecretMap.unwrap(), z.null()]).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export const McpServerListResponseSchema = z.object({
  servers: z.array(McpServerPublicSchema),
});

export const McpServerResponseSchema = z.object({
  server: McpServerPublicSchema,
});

export const ImportMcpServersRequestSchema = z.object({
  organizationId: IdSchema,
  createdBy: IdSchema,
  /** JSON blob — Claude Desktop, alt-`servers`, or bare keyed map. */
  json: z.string().min(2),
  defaultCategory: Categories.optional(),
});

export const ImportMcpServersResponseSchema = z.object({
  imported: z.array(McpServerPublicSchema),
  warnings: z.array(z.string()),
  skipped: z.array(z.object({ name: z.string(), reason: z.string() })),
});

export const CacheRecoverySchema = z.object({
  isolatedCache: z.literal(true),
  reason: z.literal('npm-cache-corrupted'),
  cacheDir: z.string(),
});

export const TestMcpResponseSchema = z.object({
  ok: z.boolean(),
  tools: z.array(McpToolDescriptorSchema),
  error: z.string().optional(),
  testedAt: z.string(),
  recovery: CacheRecoverySchema.optional(),
});

export const McpToolsResponseSchema = z.object({
  tools: z.array(McpToolDescriptorSchema),
});

export const AgentMcpAttachInputSchema = z.object({
  organizationId: IdSchema,
  mcpServerId: IdSchema,
  scope: McpAttachmentScopeSchema.optional(),
});

export const AgentMcpAttachmentsResponseSchema = z.object({
  attachments: z.array(AgentMcpAttachmentSchema),
});

// PR 6 — tier toggle wiring. PATCH body for changing the tier on an
// existing (member, server) attachment row. Routed to
// `McpRegistryService.updateAttachmentTier`, which wraps PR 1's
// `repo.updateAttachmentTier`. Note that `tier='dispatch'` is harmless
// metadata when the V2 spawn flag is off — the legacy spawn path is
// tier-blind and treats every attachment as native (§13.3 rollback).
export const UpdateAttachmentTierRequestSchema = z.object({
  organizationId: IdSchema,
  tier: McpAttachmentTierSchema,
});

export const AgentMcpAttachmentResponseSchema = z.object({
  attachment: AgentMcpAttachmentSchema,
});

// PR 10 — channel attachments. Parallel shape to the agent-side
// schemas above. The settings UI uses these on the channels-subtab;
// the V2 spawn reads channel attachments via the §17.5.3 union step
// and never goes through the REST surface.
export const ChannelMcpAttachInputSchema = z.object({
  organizationId: IdSchema,
  mcpServerId: IdSchema,
  scope: McpAttachmentScopeSchema.optional(),
});

export const ChannelMcpAttachmentsResponseSchema = z.object({
  attachments: z.array(ChannelMcpAttachmentSchema),
});

export const ChannelMcpAttachmentResponseSchema = z.object({
  attachment: ChannelMcpAttachmentSchema,
});

export const UpdateChannelAttachmentTierRequestSchema = z.object({
  organizationId: IdSchema,
  tier: McpAttachmentTierSchema,
});

// PR 9 — tier curation suggestion responses.
// `summary` lets the panel render the "0 demote / 0 promote" zero-state
// + headline counters without paging the full list.
export const TierCurationSuggestionsResponseSchema = z.object({
  suggestions: z.array(TierCurationSuggestionSchema),
  summary: z.object({
    pending: z.number().int().min(0),
    demoteCount: z.number().int().min(0),
    promoteCount: z.number().int().min(0),
  }),
});

// POST body for the admin refresh trigger. All fields optional so a
// no-body POST runs with the §9.4 defaults.
export const RefreshTierCurationRequestSchema = z.object({
  organizationId: IdSchema,
  windowRuns: z.number().int().min(1).max(1000).optional(),
  volumePerRunThreshold: z.number().min(0).optional(),
  errorRateThreshold: z.number().min(0).max(1).optional(),
});

export const RefreshTierCurationResponseSchema = z.object({
  suggestionsWritten: z.number().int().min(0),
  demoteCount: z.number().int().min(0),
  promoteCount: z.number().int().min(0),
  runsConsidered: z.number().int().min(0),
});

// PR 9 — operator decision on a suggestion. `applied` after the
// operator clicks Apply (and the tier flip succeeds); `dismissed`
// if a future UI exposes a hide action. The body's organizationId
// scopes the mutation; the path param identifies the suggestion.
export const UpdateTierCurationSuggestionStatusRequestSchema = z.object({
  organizationId: IdSchema,
  status: z.enum(['pending', 'applied', 'dismissed']),
});

export const TierCurationSuggestionResponseSchema = z.object({
  suggestion: TierCurationSuggestionSchema,
});

export const McpScopedQuerySchema = z.object({
  organizationId: IdSchema,
});

// ---------------- Governance catalog + classification ----------------

const EvaluationSourceEnum = z.enum([
  'platform_deny',
  'agent_rule',
  'platform_allow',
  'platform_require_approval',
  'risk_default',
  'default',
]);

export const McpCatalogToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  risk: ToolRiskClass,
  source: z.enum(['inferred', 'manual', 'registry', 'unknown']),
  needsReview: z.boolean(),
  effective: z.object({
    state: ToolPolicyState,
    source: EvaluationSourceEnum,
    reason: z.string().optional(),
    // True when the decision comes from a rule targeting THIS exact (mcp, tool)
    // — not a wildcard/family rule, not an inherited default. Defaults false for
    // back-compat with older daemons that don't emit it.
    exactRule: z.boolean().default(false),
  }),
  grantedAgents: z.array(z.string()),
  attachedAgents: z.array(z.string()),
});
export type McpCatalogTool = z.infer<typeof McpCatalogToolSchema>;

export const McpCatalogServerSchema = z.object({
  id: IdSchema,
  name: z.string(),
  status: z.string(),
  category: z.string(),
  toolCount: z.number().int().nonnegative(),
  // Agents with ≥1 per-tool grant on this specific server. Used by the
  // UI to decide "exposed" per (agent, server) — see CatalogAgentView.
  allowlistAgents: z.array(z.string()),
  tools: z.array(McpCatalogToolSchema),
  // PR 6 — per-active-agent attachment tier. Populated only when the
  // catalog is fetched with `?agentId=...`; absent otherwise. Lets the
  // Agents tab render the tier toggle without a second round trip.
  // Native tier means the runtime's typed-palette path; dispatch tier
  // means the meta-tool dispatch path. Harmless when V2 flag is off.
  agentTier: McpAttachmentTierSchema.optional(),
});
export type McpCatalogServer = z.infer<typeof McpCatalogServerSchema>;

export const CatalogAgentViewSchema = z.object({
  agentId: z.string(),
  state: ToolPolicyState,
  source: EvaluationSourceEnum,
  reason: z.string().optional(),
  exposed: z.boolean(),
  exposureReason: z.enum([
    'no-mcp-attachment',
    'no-tool-grant',
    'granted',
    'all-tools-mode',
  ]),
});
export type CatalogAgentView = z.infer<typeof CatalogAgentViewSchema>;

export const McpCatalogResponseSchema = z.object({
  servers: z.array(McpCatalogServerSchema),
  riskDefaults: RiskDefaultsSchema,
  agentView: z.record(z.string(), CatalogAgentViewSchema).optional(),
  agentViewId: z.string().optional(),
});
export type McpCatalogResponse = z.infer<typeof McpCatalogResponseSchema>;

export const McpCatalogQuerySchema = z.object({
  organizationId: IdSchema,
  agentId: z.string().min(1).optional(),
  // When set, the catalog only considers per-tool grants whose scope
  // matches this role (or 'both'). Unspecified = role-agnostic union.
  role: z.enum(['worker', 'supervisor']).optional(),
});
export type McpCatalogQuery = z.infer<typeof McpCatalogQuerySchema>;

// ---------------- Per-tool grants ------------------------------------

export const GrantToolRequestSchema = z.object({
  organizationId: IdSchema,
  scope: z.enum(['worker', 'supervisor', 'both']).optional(),
});
export type GrantToolRequest = z.infer<typeof GrantToolRequestSchema>;

export const AgentToolAttachmentRowSchema = z.object({
  organizationId: IdSchema,
  memberId: IdSchema,
  mcpServerId: IdSchema,
  toolName: z.string(),
  scope: z.enum(['worker', 'supervisor', 'both']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentToolAttachmentRow = z.infer<typeof AgentToolAttachmentRowSchema>;

export const GrantToolResponseSchema = z.object({
  attachment: AgentToolAttachmentRowSchema,
});
export type GrantToolResponse = z.infer<typeof GrantToolResponseSchema>;

export const AgentToolGrantsResponseSchema = z.object({
  agentId: z.string(),
  grants: z.array(AgentToolAttachmentRowSchema),
});
export type AgentToolGrantsResponse = z.infer<typeof AgentToolGrantsResponseSchema>;

export const UpdateToolClassificationRequestSchema = z.object({
  organizationId: IdSchema,
  risk: ToolRiskClass,
  reason: z.string().max(2000).optional(),
});
export type UpdateToolClassificationRequest = z.infer<
  typeof UpdateToolClassificationRequestSchema
>;

export const ToolClassificationResponseSchema = z.object({
  tool: McpCatalogToolSchema,
});
export type ToolClassificationResponse = z.infer<typeof ToolClassificationResponseSchema>;

// ---------------- Governance policy CRUD -----------------------------

export const GovernancePolicyResponseSchema = z.object({
  policy: GovernancePolicy,
});
export type GovernancePolicyResponse = z.infer<typeof GovernancePolicyResponseSchema>;

export const UpdateRiskDefaultsRequestSchema = z.object({
  organizationId: IdSchema,
  riskDefaults: z
    .object({
      read: ToolPolicyState.optional(),
      write: ToolPolicyState.optional(),
      destructive: ToolPolicyState.optional(),
      unknown: ToolPolicyState.optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
      message: 'At least one risk class must be provided',
    }),
});
export type UpdateRiskDefaultsRequest = z.infer<typeof UpdateRiskDefaultsRequestSchema>;

export const SetToolRuleRequestSchema = z.object({
  organizationId: IdSchema,
  mcpId: z.string().min(1),
  // Trailing `*` allowed to cover a family (e.g. `browser_*`).
  toolName: z.string().min(1),
  state: z.enum(['allow', 'require_approval', 'deny', 'inherit']),
  reason: z.string().optional(),
});
export type SetToolRuleRequest = z.infer<typeof SetToolRuleRequestSchema>;

export type CreateMcpServerRequest = z.infer<typeof CreateMcpServerRequestSchema>;
export type UpdateMcpServerRequest = z.infer<typeof UpdateMcpServerRequestSchema>;
export type ImportMcpServersRequest = z.infer<typeof ImportMcpServersRequestSchema>;
export type ImportMcpServersResponse = z.infer<typeof ImportMcpServersResponseSchema>;
export type TestMcpResponse = z.infer<typeof TestMcpResponseSchema>;
export type McpServerListResponse = z.infer<typeof McpServerListResponseSchema>;
export type McpServerResponse = z.infer<typeof McpServerResponseSchema>;
export type McpToolsResponse = z.infer<typeof McpToolsResponseSchema>;
export type AgentMcpAttachInput = z.infer<typeof AgentMcpAttachInputSchema>;
export type AgentMcpAttachmentsResponse = z.infer<typeof AgentMcpAttachmentsResponseSchema>;
export type AgentMcpAttachmentResponse = z.infer<typeof AgentMcpAttachmentResponseSchema>;
export type ChannelMcpAttachInput = z.infer<typeof ChannelMcpAttachInputSchema>;
export type ChannelMcpAttachmentsResponse = z.infer<typeof ChannelMcpAttachmentsResponseSchema>;
export type ChannelMcpAttachmentResponse = z.infer<typeof ChannelMcpAttachmentResponseSchema>;
export type UpdateChannelAttachmentTierRequest = z.infer<
  typeof UpdateChannelAttachmentTierRequestSchema
>;
export type UpdateAttachmentTierRequest = z.infer<typeof UpdateAttachmentTierRequestSchema>;
export type TierCurationSuggestionsResponse = z.infer<typeof TierCurationSuggestionsResponseSchema>;
export type RefreshTierCurationRequest = z.infer<typeof RefreshTierCurationRequestSchema>;
export type RefreshTierCurationResponse = z.infer<typeof RefreshTierCurationResponseSchema>;
export type UpdateTierCurationSuggestionStatusRequest = z.infer<
  typeof UpdateTierCurationSuggestionStatusRequestSchema
>;
export type TierCurationSuggestionResponse = z.infer<typeof TierCurationSuggestionResponseSchema>;
