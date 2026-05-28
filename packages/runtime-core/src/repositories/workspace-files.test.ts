import { expect, test } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import { WorkspaceFileSchema } from '@ujima/shared';
import { Repository } from './index.js';

test('upsertWorkspaceFile evicts enough oldest rows to satisfy the org byte cap', () => {
  const db = openDatabase({ dbPath: ':memory:' });
  const repo = new Repository(db);
  const organizationId = 'org-workspace-file-cap';
  const generousCaps = { perOrgByteCap: 1_000, perFileByteCap: 1_000 };

  const upsertFile = (
    path: string,
    body: string,
    updatedAt: string,
    perOrgByteCap: number,
  ) => {
    repo.upsertWorkspaceFile(
      WorkspaceFileSchema.parse({
        organizationId,
        path,
        body,
        writtenBy: 'member-a',
        channelId: 'channel-a',
        sizeBytes: body.length,
        updatedAt,
      }),
      { ...generousCaps, perOrgByteCap },
    );
  };

  for (let i = 0; i < 20; i += 1) {
    upsertFile(
      `/file-${String(i).padStart(2, '0')}.md`,
      String(i).padStart(2, '0').repeat(5),
      `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      generousCaps.perOrgByteCap,
    );
  }

  upsertFile('/file-new.md', 'newestbody', '2026-01-01T00:00:20.000Z', 50);

  const totalRow = db
    .prepare(
      `SELECT COALESCE(SUM(LENGTH(body)), 0) AS total
         FROM workspace_files
        WHERE organization_id = ?`,
    )
    .get(organizationId) as { total: number };
  const remaining = db
    .prepare(
      `SELECT path
         FROM workspace_files
        WHERE organization_id = ?
        ORDER BY updated_at ASC, path ASC`,
    )
    .all(organizationId) as { path: string }[];

  expect(totalRow.total).toBeLessThanOrEqual(50);
  expect(remaining.map((row) => row.path)).toEqual([
    '/file-16.md',
    '/file-17.md',
    '/file-18.md',
    '/file-19.md',
    '/file-new.md',
  ]);
});

test('searchWorkspaceFiles filters sensitive paths before exposing snippets', () => {
  const db = openDatabase({ dbPath: ':memory:' });
  const repo = new Repository(db);
  const organizationId = 'org-workspace-file-sensitive';
  const base = {
    organizationId,
    writtenBy: 'member-a',
    channelId: 'channel-a',
    sizeBytes: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  repo.upsertWorkspaceFile(
    WorkspaceFileSchema.parse({
      ...base,
      path: '.env',
      body: 'TOP_SECRET_TOKEN=needle-secret',
      sizeBytes: 'TOP_SECRET_TOKEN=needle-secret'.length,
    }),
  );
  repo.upsertWorkspaceFile(
    WorkspaceFileSchema.parse({
      ...base,
      path: 'docs/public-note.md',
      body: 'needle public note',
      sizeBytes: 'needle public note'.length,
      updatedAt: '2026-01-01T00:00:01.000Z',
    }),
  );

  const hits = repo.searchWorkspaceFiles({
    organizationId,
    query: 'needle',
    limit: 10,
  });

  expect(hits.map((hit) => hit.path)).toEqual(['docs/public-note.md']);
  expect(hits.map((hit) => hit.snippet).join('\n')).not.toContain('TOP_SECRET_TOKEN');
});
