import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db';

describe('database migrations', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('backfills message_mentions from legacy messages.mentions during 006 upgrade', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ujima-db-migration-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'legacy.sqlite');

    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE channels (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        topic TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE members (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        role_name TEXT NOT NULL,
        presence TEXT NOT NULL DEFAULT 'offline',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        channel_id TEXT,
        sender_id TEXT NOT NULL,
        sender_kind TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        mentions TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        tool_calls TEXT NOT NULL DEFAULT '[]'
      );
    `);

    const appliedAt = Date.now();
    const insertMigration = legacy.prepare(
      'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
    );
    for (const id of [
      '001_initial',
      '002_workspaces',
      '003_org_mode_core',
      '004_additive_ports',
      '005_config_reconcile',
    ]) {
      insertMigration.run(id, appliedAt);
    }

    legacy
      .prepare(
        `INSERT INTO channels (
          id, organization_id, name, kind, topic, created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'general',
        'org-1',
        'general',
        'general',
        '',
        '2026-04-27T08:00:00.000Z',
        '2026-04-27T08:00:00.000Z',
        null,
      );

    legacy
      .prepare(
        `INSERT INTO messages (
          id,
          organization_id,
          thread_id,
          channel_id,
          sender_id,
          sender_kind,
          kind,
          content,
          mentions,
          created_at,
          tool_calls
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'msg-1',
        'org-1',
        'general',
        'general',
        'owner',
        'human',
        'human',
        'hello team',
        '["frontend-alice","frontend-bob"]',
        '2026-04-27T08:00:00.000Z',
        '[]',
      );
    legacy.close();

    const upgraded = openDatabase({ dbPath });
    const mentions = upgraded
      .prepare(
        'SELECT message_id, member_id, kind, created_at FROM message_mentions WHERE message_id = ? ORDER BY member_id ASC',
      )
      .all('msg-1') as {
      message_id: string;
      member_id: string;
      kind: string;
      created_at: string;
    }[];

    expect(mentions).toEqual([
      {
        message_id: 'msg-1',
        member_id: 'frontend-alice',
        kind: 'mention',
        created_at: '2026-04-27T08:00:00.000Z',
      },
      {
        message_id: 'msg-1',
        member_id: 'frontend-bob',
        kind: 'mention',
        created_at: '2026-04-27T08:00:00.000Z',
      },
    ]);

    upgraded.close();
  });
});
