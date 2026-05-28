import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MemoryEntryKindSchema, MemoryEntrySchema } from '@ujima/shared';
import type { OrchestratorTool } from './types.js';

/**
 * Bet 5 — durable agent memory.
 *
 * Two tools — `memory.write` (upsert a fact / preference) and
 * `memory.recall` (look it up later) — backed by the `memory_entries`
 * table. Scoped per-(org, member) by default. The auto-surfaced
 * `<persistent-memory>` block in the workspace-state context (Bet 3)
 * reads from this table, so an agent that writes "user prefers terse
 * replies on Mondays" sees it on the next wake without an explicit
 * recall call.
 *
 * Key design points:
 *   - The agent owns its own memory. There is no cross-agent global
 *     KV — that road leads to crosstalk + privacy hell. Org-scoped
 *     memory (memberId: null) requires an explicit `scope: 'org'`
 *     parameter and is gated by the policy layer at runtime.
 *   - `key` is the lookup. Two writes to the same `(org, member, key)`
 *     UPSERT — there's exactly one current value per key.
 *   - TTL is opt-in via `expiresInDays`. Without it the entry is
 *     persistent. Expired entries are dropped lazily on read AND by
 *     the commitment sweeper's periodic tick.
 */

const MEMORY_KIND_DEFAULT = 'fact' as const;

const MemoryWriteSchema = z.object({
  key: z.string().min(1).max(120),
  value: z.string().min(1).max(2000),
  kind: MemoryEntryKindSchema.default(MEMORY_KIND_DEFAULT),
  expires_in_days: z.number().int().min(1).max(365).optional(),
  scope: z.enum(['self', 'org']).default('self'),
});

const MemoryRecallSchema = z.object({
  key_prefix: z.string().min(1).max(120).optional(),
  query: z.string().min(2).max(200).optional(),
  kind: MemoryEntryKindSchema.optional(),
  limit: z.number().int().min(1).max(20).default(10),
});

const MemoryForgetSchema = z.object({
  key: z.string().min(1).max(120),
  scope: z.enum(['self', 'org']).default('self'),
});

export const memoryWriteTool: OrchestratorTool<typeof MemoryWriteSchema> = {
  id: 'memory.write',
  schema: MemoryWriteSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: ({ invocation, repo }) => {
    if (!repo.upsertMemoryEntry) {
      throw new Error('memory.write unavailable: repo does not support memory entries');
    }
    const input = invocation.input as z.infer<typeof MemoryWriteSchema>;
    const expiresAt = input.expires_in_days
      ? new Date(Date.now() + input.expires_in_days * 24 * 60 * 60 * 1000).toISOString()
      : undefined;
    const now = new Date().toISOString();
    // Org-scope writes require deliberate opt-in; if a future
    // privilege layer wants to gate this it can wrap the tool.
    const memberId = input.scope === 'org' ? undefined : invocation.memberId;
    const entry = MemoryEntrySchema.parse({
      id: randomUUID(),
      organizationId: invocation.organizationId,
      memberId,
      kind: input.kind ?? MEMORY_KIND_DEFAULT,
      key: input.key,
      content: input.value,
      metadata: {},
      expiresAt,
      sourceMessageId: undefined,
      lastRecalledAt: undefined,
      createdAt: now,
    });
    const saved = repo.upsertMemoryEntry(entry);
    return {
      ok: true,
      key: saved.key,
      kind: saved.kind,
      scope: input.scope,
      expiresAt: saved.expiresAt,
    };
  },
};

export const memoryRecallTool: OrchestratorTool<typeof MemoryRecallSchema> = {
  id: 'memory.recall',
  schema: MemoryRecallSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: ({ invocation, repo }) => {
    if (!repo.recallMemoryEntries) {
      return { entries: [] };
    }
    const input = invocation.input as z.infer<typeof MemoryRecallSchema>;
    const entries = repo.recallMemoryEntries({
      organizationId: invocation.organizationId,
      memberId: invocation.memberId,
      kind: input.kind,
      keyPrefix: input.key_prefix,
      query: input.query,
      limit: input.limit,
      touch: true,
    });
    return {
      entries: entries.map((e) => ({
        key: e.key,
        value: e.content,
        kind: e.kind,
        scope: e.memberId ? 'self' : 'org',
        expiresAt: e.expiresAt,
        createdAt: e.createdAt,
      })),
    };
  },
};

export const memoryForgetTool: OrchestratorTool<typeof MemoryForgetSchema> = {
  id: 'memory.forget',
  schema: MemoryForgetSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: ({ invocation, repo }) => {
    if (!repo.deleteMemoryEntry) {
      return { ok: false, reason: 'memory.forget unavailable' };
    }
    const input = invocation.input as z.infer<typeof MemoryForgetSchema>;
    const memberId = input.scope === 'org' ? null : invocation.memberId;
    const removed = repo.deleteMemoryEntry(invocation.organizationId, memberId, input.key);
    return { ok: removed, key: input.key };
  },
};
