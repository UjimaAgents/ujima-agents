import { z } from 'zod';
import type { OrchestratorTool } from './types.js';
import { randomUUID } from 'node:crypto';

const MemorySaveSchema = z.object({
  kind: z.enum(['action', 'decision', 'fact', 'correction']),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const memorySaveTool: OrchestratorTool<typeof MemorySaveSchema> = {
  id: 'memory.save',
  schema: MemorySaveSchema,
  toInvocation: (args) => ({
    action: 'execute',
    resourceType: 'message',
    bypassPermission: true, // Agent memory access is implicitly safe and does not need user confirmation
    input: args,
  }),
  execute: ({ invocation, repo }) => {
    const args = MemorySaveSchema.parse(invocation.input);
    const entry = repo.saveMemory({
      id: randomUUID(),
      organizationId: invocation.organizationId,
      memberId: invocation.memberId,
      kind: args.kind,
      content: args.content,
      metadata: args.metadata ?? {},
      createdAt: new Date().toISOString(),
    });
    return { success: true, memory: entry };
  },
};

const MemoryRecallSchema = z.object({
  query: z.string().optional(),
});

export const memoryRecallTool: OrchestratorTool<typeof MemoryRecallSchema> = {
  id: 'memory.recall',
  schema: MemoryRecallSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'message',
    bypassPermission: true, // Recalling personal agent memories is implicitly safe
    input: args,
  }),
  execute: ({ invocation, repo }) => {
    const args = MemoryRecallSchema.parse(invocation.input);
    const memories = repo.listMemories(invocation.organizationId, invocation.memberId);

    if (args.query) {
      const q = args.query.toLowerCase();
      const filtered = memories.filter(
        (m) =>
          m.content.toLowerCase().includes(q) ||
          m.kind.toLowerCase().includes(q),
      );
      return { memories: filtered };
    }

    return { memories };
  },
};
