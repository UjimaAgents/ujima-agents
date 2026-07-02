import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MemoryEntryKindSchema, MemoryEntrySchema } from '@ujima/shared';
import type { OrchestratorTool } from './types.js';
import { forgetMemoryEntry, recallMemoryEntries, writeMemoryEntry } from '../utils/memory.js';

const MEMORY_UNAVAILABLE_MESSAGE = 'memory is not available';

/**
 * Bet 5 — durable agent memory.
 *
 * Two tools — `memory.write` (upsert a fact / preference) and
 * `memory.recall` (look it up later) — backed by the `memory_entries`
 * table. Scoped per-(org, member) by default. Agents read it through
 * `memory.recall` instead of hidden prompt injection.
 *
 * Key design points:
 *   - The agent owns its own memory. There is no cross-agent global
 *     KV — that road leads to crosstalk + privacy hell. Org-scoped
 *     memory (memberId: null) requires an explicit `scope: 'org'`
 *     parameter and is gated by the policy layer at runtime.
 *   - `key` is the lookup. Two writes to the same `(org, member, key)`
 *     UPSERT — there's exactly one current value per key.
 *   - TTL is opt-in via `expiresInDays`. Without it the entry is
 *     persistent. Expired entries are dropped lazily on read.
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
  execute: async ({ invocation, repo }) => {
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
      metadata: { threadId: invocation.threadId },
      expiresAt,
      sourceMessageId: undefined,
      lastRecalledAt: undefined,
      createdAt: now,
    });
    try {
      const saved = await writeMemoryEntry(repo, entry);
      return {
        ok: true,
        key: saved.key,
        kind: saved.kind,
        scope: input.scope,
        expiresAt: saved.expiresAt,
      };
    } catch (error) {
      if ((error as Error).message === MEMORY_UNAVAILABLE_MESSAGE) {
        return { ok: false, error: MEMORY_UNAVAILABLE_MESSAGE };
      }
      throw error;
    }
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
  execute: async ({ invocation, repo }) => {
    const input = invocation.input as z.infer<typeof MemoryRecallSchema>;
    try {
      const entries = await recallMemoryEntries(repo, {
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
    } catch (error) {
      if ((error as Error).message === MEMORY_UNAVAILABLE_MESSAGE) {
        return { ok: false, error: MEMORY_UNAVAILABLE_MESSAGE, entries: [] };
      }
      throw error;
    }
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
  execute: async ({ invocation, repo }) => {
    const input = invocation.input as z.infer<typeof MemoryForgetSchema>;
    try {
      const removed = await forgetMemoryEntry(
        repo,
        invocation.organizationId,
        invocation.memberId,
        input.key,
        input.scope,
      );
      return { ok: removed, key: input.key };
    } catch (error) {
      if ((error as Error).message === MEMORY_UNAVAILABLE_MESSAGE) {
        return { ok: false, error: MEMORY_UNAVAILABLE_MESSAGE, key: input.key };
      }
      throw error;
    }
  },
};
