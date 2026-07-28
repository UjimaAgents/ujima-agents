import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db';

interface LegacySqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): { run(...params: unknown[]): unknown };
  close(): void;
}

type LegacySqliteCtor = new (path: string) => LegacySqliteDatabase;

const requireSqlite = createRequire(__filename);

function resolveLegacyTestDatabase(): LegacySqliteCtor {
  const isBun = typeof process !== 'undefined' && Boolean(process.versions?.bun);
  if (isBun) {
    return (requireSqlite('bun:sqlite') as { Database: LegacySqliteCtor }).Database;
  }
  try {
    return (requireSqlite('node:sqlite') as { DatabaseSync: LegacySqliteCtor }).DatabaseSync;
  } catch {
    return requireSqlite('better-sqlite3') as LegacySqliteCtor;
  }
}

const LegacyDatabase = resolveLegacyTestDatabase();

describe('database migrations', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('backfills message_mentions from legacy messages.mentions during 006 upgrade', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ujima-db-migration-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'legacy.sqlite');

    const legacy = new LegacyDatabase(dbPath);
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
        updated_at TEXT NOT NULL,
        retired_at TEXT
      );

      -- Link tables introduced by 003_org_mode_core. Migration 043 ALTERs
      -- both into composite-keyed shapes, so they must exist on legacy
      -- fixtures that claim 003 was applied or the rename fails.
      CREATE TABLE channel_members (
        channel_id TEXT NOT NULL,
        member_id  TEXT NOT NULL,
        PRIMARY KEY (channel_id, member_id)
      );

      CREATE TABLE channel_member_modes (
        channel_id TEXT NOT NULL,
        member_id  TEXT NOT NULL,
        mode       TEXT NOT NULL DEFAULT 'active',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (channel_id, member_id)
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

      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        thread_id TEXT,
        status TEXT NOT NULL,
        step TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        ended_at TEXT
      );

      -- Tables introduced by 004_additive_ports. The fixture is hand-
      -- rolled so each migration we mark "applied" must have its
      -- artefacts present, otherwise later migrations that ALTER one
      -- of them (e.g. 009 ADDS task_session_id to todos, 027 ALTERs
      -- memory_entries) blow up.
      CREATE TABLE todos (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        run_id           TEXT,
        member_id        TEXT NOT NULL,
        title            TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'pending',
        notes            TEXT NOT NULL DEFAULT '',
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );

      CREATE TABLE memory_entries (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        member_id        TEXT,
        kind             TEXT NOT NULL,
        content          TEXT NOT NULL,
        metadata         TEXT NOT NULL DEFAULT '{}',
        created_at       TEXT NOT NULL
      );

      CREATE TABLE approvals (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        run_id           TEXT,
        requested_by     TEXT NOT NULL,
        resource_type    TEXT NOT NULL,
        resource_path    TEXT NOT NULL,
        action           TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'pending',
        reason           TEXT NOT NULL DEFAULT '',
        created_at       TEXT NOT NULL,
        resolved_at      TEXT,
        tool_call_id     TEXT
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

  it('migration 049 lands server_id/tool_name/args_json on the live audit_events (not the pre-003 renamed table)', () => {
    // Locks in that 049 targets the post-003 audit_events table, the one
    // the dispatch plan's §12 audit-write layer (PR 7) will populate.
    // Migration 003 both RENAMEs the original audit_events to
    // task_audit_events and CREATEs a fresh audit_events with the
    // action/target_type shape — both happen in the same 003 body, so
    // by the time 049 runs the live table exists and the ALTERs apply
    // to the right rows. A previous review iteration mistook the rename
    // for a destruction; this test refutes that class of concern.
    const db = openDatabase({ dbPath: ':memory:' });
    const cols = (
      db.prepare('PRAGMA table_info(audit_events)').all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['server_id', 'tool_name', 'args_json']));

    const taskCols = (
      db.prepare('PRAGMA table_info(task_audit_events)').all() as { name: string }[]
    ).map((c) => c.name);
    // The pre-003 renamed table is untouched by 049 — proof that we
    // ALTERed the right table.
    expect(taskCols).not.toContain('server_id');
    expect(taskCols).not.toContain('args_json');

    db.close();
  });
});
