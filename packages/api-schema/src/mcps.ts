import { z } from 'zod';
import {
  AgentMcpAttachmentSchema,
  GovernancePolicy,
  IdSchema,
  McpAttachmentScopeSchema,
  McpIsolationSchema,
  McpServerPublicSchema,
  McpToolDescriptorSchema,
  McpTransportSchema,
  RiskDefaultsSchema,
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

export const McpScopedQuerySchema = z.object({
  organizationId: IdSchema,
});

// ---------------- Governance catalog + classification ----------------

const EvaluationSourceEnum = z.enum([
  'platform_deny',
  'agent_rule',
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
