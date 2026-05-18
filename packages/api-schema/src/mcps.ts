import { z } from 'zod';
import {
  AgentMcpAttachmentSchema,
  IdSchema,
  McpAttachmentScopeSchema,
  McpIsolationSchema,
  McpServerPublicSchema,
  McpToolDescriptorSchema,
  McpTransportSchema,
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

export const TestMcpResponseSchema = z.object({
  ok: z.boolean(),
  tools: z.array(McpToolDescriptorSchema),
  error: z.string().optional(),
  testedAt: z.string(),
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
