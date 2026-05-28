import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  McpServerSchema,
  type McpServer,
  type McpToolClassification,
} from '@ujima/shared';
import { openDatabase } from '@ujima/context-store';
import { Repository } from './index.js';

function freshRepo(): Repository {
  return new Repository(openDatabase({ dbPath: ':memory:' }));
}

function makeServer(organizationId: string, overrides: Partial<McpServer> = {}): McpServer {
  const now = new Date().toISOString();
  return McpServerSchema.parse({
    id: overrides.id ?? `srv_${randomUUID()}`,
    organizationId,
    name: overrides.name ?? 'fs',
    description: '',
    category: 'filesystem',
    transport: 'stdio',
    command: 'true',
    args: [],
    isolation: 'shared',
    status: 'active',
    createdBy: 'admin',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

describe('mcp_tool_classifications repository', () => {
  it('seeds inferred rows and returns the count inserted', () => {
    const repo = freshRepo();
    const orgId = `org_${randomUUID()}`;
    const server = makeServer(orgId);
    repo.saveMcpServer(server);

    const n = repo.seedInferredClassifications(orgId, server.id, [
      { toolName: 'get_file', risk: 'read' },
      { toolName: 'delete_file', risk: 'destructive' },
    ]);
    expect(n).toBe(2);

    const list = repo.listMcpToolClassifications(orgId);
    expect(list).toHaveLength(2);
    const getFile = list.find((r) => r.toolName === 'get_file');
    expect(getFile?.risk).toBe('read');
    expect(getFile?.source).toBe('inferred');
  });

  it('INSERT OR IGNORE: re-seeding the same tool does not change existing rows', () => {
    const repo = freshRepo();
    const orgId = `org_${randomUUID()}`;
    const server = makeServer(orgId);
    repo.saveMcpServer(server);

    repo.seedInferredClassifications(orgId, server.id, [
      { toolName: 'get_file', risk: 'read' },
    ]);
    const first = repo.getMcpToolClassification(orgId, server.id, 'get_file')!;

    // Re-seed with a different risk — must NOT overwrite.
    const inserted = repo.seedInferredClassifications(orgId, server.id, [
      { toolName: 'get_file', risk: 'destructive' },
    ]);
    expect(inserted).toBe(0);

    const after = repo.getMcpToolClassification(orgId, server.id, 'get_file')!;
    expect(after.risk).toBe('read');
    expect(after.updatedAt).toBe(first.updatedAt);
  });

  it('manual overrides survive re-seeding (the load-bearing safety property)', () => {
    const repo = freshRepo();
    const orgId = `org_${randomUUID()}`;
    const server = makeServer(orgId);
    repo.saveMcpServer(server);

    // Admin classifies a write tool as destructive.
    const manualRow: McpToolClassification = {
      organizationId: orgId,
      mcpServerId: server.id,
      toolName: 'update_record',
      risk: 'destructive',
      source: 'manual',
      needsReview: false,
      reason: 'PII column writes',
      updatedAt: new Date().toISOString(),
      updatedBy: 'admin',
    };
    repo.upsertMcpToolClassification(manualRow);

    // Re-running Test triggers inferred seeding for the same tool.
    repo.seedInferredClassifications(orgId, server.id, [
      { toolName: 'update_record', risk: 'write' },
    ]);

    const after = repo.getMcpToolClassification(orgId, server.id, 'update_record')!;
    expect(after.risk).toBe('destructive');
    expect(after.source).toBe('manual');
    expect(after.reason).toBe('PII column writes');
  });

  it('upsert flips an inferred row to manual', () => {
    const repo = freshRepo();
    const orgId = `org_${randomUUID()}`;
    const server = makeServer(orgId);
    repo.saveMcpServer(server);
    repo.seedInferredClassifications(orgId, server.id, [
      { toolName: 'read_x', risk: 'read', needsReview: true },
    ]);

    repo.upsertMcpToolClassification({
      organizationId: orgId,
      mcpServerId: server.id,
      toolName: 'read_x',
      risk: 'write',
      source: 'manual',
      needsReview: false,
      updatedAt: new Date().toISOString(),
      updatedBy: 'admin',
    });

    const after = repo.getMcpToolClassification(orgId, server.id, 'read_x')!;
    expect(after.risk).toBe('write');
    expect(after.source).toBe('manual');
    expect(after.needsReview).toBe(false);
  });

  it('listMcpToolClassifications can scope to a single mcpServerId', () => {
    const repo = freshRepo();
    const orgId = `org_${randomUUID()}`;
    const a = makeServer(orgId, { name: 'a' });
    const b = makeServer(orgId, { name: 'b' });
    repo.saveMcpServer(a);
    repo.saveMcpServer(b);
    repo.seedInferredClassifications(orgId, a.id, [{ toolName: 't', risk: 'read' }]);
    repo.seedInferredClassifications(orgId, b.id, [{ toolName: 'u', risk: 'write' }]);

    expect(repo.listMcpToolClassifications(orgId)).toHaveLength(2);
    expect(repo.listMcpToolClassifications(orgId, a.id)).toHaveLength(1);
    expect(repo.listMcpToolClassifications(orgId, a.id)[0]?.toolName).toBe('t');
  });

  it('orgs are isolated', () => {
    const repo = freshRepo();
    const o1 = `org_${randomUUID()}`;
    const o2 = `org_${randomUUID()}`;
    const s1 = makeServer(o1);
    const s2 = makeServer(o2, { id: s1.id }); // intentional id collision across orgs
    repo.saveMcpServer(s1);
    repo.saveMcpServer(s2);
    repo.seedInferredClassifications(o1, s1.id, [{ toolName: 't', risk: 'read' }]);

    expect(repo.listMcpToolClassifications(o1)).toHaveLength(1);
    expect(repo.listMcpToolClassifications(o2)).toHaveLength(0);
  });

  it('deleteMcpServer cascades to classifications', () => {
    const repo = freshRepo();
    const orgId = `org_${randomUUID()}`;
    const server = makeServer(orgId);
    repo.saveMcpServer(server);
    repo.seedInferredClassifications(orgId, server.id, [
      { toolName: 't', risk: 'read' },
      { toolName: 'u', risk: 'write' },
    ]);
    expect(repo.listMcpToolClassifications(orgId, server.id)).toHaveLength(2);

    repo.deleteMcpServer(orgId, server.id);
    expect(repo.listMcpToolClassifications(orgId, server.id)).toHaveLength(0);
  });

  it('deleteMcpToolClassification removes a single row only', () => {
    const repo = freshRepo();
    const orgId = `org_${randomUUID()}`;
    const server = makeServer(orgId);
    repo.saveMcpServer(server);
    repo.seedInferredClassifications(orgId, server.id, [
      { toolName: 't', risk: 'read' },
      { toolName: 'u', risk: 'write' },
    ]);
    repo.deleteMcpToolClassification(orgId, server.id, 't');
    const remaining = repo.listMcpToolClassifications(orgId, server.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.toolName).toBe('u');
  });
});
