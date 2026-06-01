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
        updated_at TEXT NOT NULL,
        retired_at TEXT
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

  it('opens a fresh database without re-adding interactive_questions.run_id (037 + 038)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ujima-db-fresh-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'fresh.sqlite');

    const db = openDatabase({ dbPath });
    const columns = (
      db.prepare('PRAGMA table_info(interactive_questions)').all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).toContain('run_id');
    const migrations = (
      db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]
    ).map((row) => row.id);
    expect(migrations).toContain('037_goal_task_questions');
    expect(migrations).toContain('038_interactive_questions_run_id');
    expect(migrations).toContain('039_interactive_questions_tool_call_id');
    db.close();
  });

  it('backfills channel_member_modes on existing databases that pre-date the table (040)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ujima-db-cmm-backfill-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'legacy.sqlite');

    // Simulate a DB that passed 001_initial before channel_member_modes
    // was added to it: drop the table and forget the 040 row, re-open.
    const tableExists = (db: ReturnType<typeof openDatabase>) =>
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='channel_member_modes'").all() as { name: string }[]).length;

    let db = openDatabase({ dbPath });
    db.exec('DROP TABLE channel_member_modes');
    db.prepare("DELETE FROM schema_migrations WHERE id = '040_channel_member_modes_backfill'").run();
    expect(tableExists(db)).toBe(0);
    db.close();

    db = openDatabase({ dbPath });
    expect(tableExists(db)).toBe(1);
    const migrations = (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((row) => row.id);
    expect(migrations).toContain('040_channel_member_modes_backfill');
    db.close();
  });

  it('migrates self notes to memory entries during 027 upgrade', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ujima-db-migration-self-note-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'legacy.sqlite');

    // Setup an empty DB with migrations applied up to 026
    const db = openDatabase({ dbPath });
    
    // Now seed some channels and messages
    db.prepare(
      `INSERT INTO channels (id, organization_id, name, kind, topic, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('self-chan-Alice', 'org-1', 'Alice (self)', 'self', 'Private working notes', '2026-04-27T08:00:00Z', '2026-04-27T08:00:00Z');

    db.prepare(
      `INSERT INTO channels (id, organization_id, name, kind, topic, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('general', 'org-1', 'general', 'general', '', '2026-04-27T08:00:00Z', '2026-04-27T08:00:00Z');

    db.prepare(
      `INSERT INTO messages (id, organization_id, thread_id, channel_id, sender_id, sender_kind, kind, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('self-msg-1', 'org-1', 'self-chan-Alice', 'self-chan-Alice', 'alice', 'agent', 'agent', 'Remember to delete the scheduler.', '2026-04-27T08:01:00Z');

    db.prepare(
      `INSERT INTO messages (id, organization_id, thread_id, channel_id, sender_id, sender_kind, kind, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('public-msg-1', 'org-1', 'general', 'general', 'alice', 'agent', 'agent', 'Hello everyone!', '2026-04-27T08:02:00Z');

    db.close();

    // Now delete the migration record for 027 to simulate upgrading from 026 to 027
    const rawDb = new Database(dbPath);
    rawDb.prepare('DELETE FROM schema_migrations WHERE id = ?').run('033_migrate_self_notes_to_memories');
    // Clear out memory_entries table to make sure migration re-populates it
    rawDb.prepare('DELETE FROM memory_entries').run();
    rawDb.close();

    // Opening it again with openDatabase will apply the 027 migration
    const upgraded = openDatabase({ dbPath });
    const memories = upgraded.prepare('SELECT * FROM memory_entries ORDER BY created_at ASC').all() as {
      id: string;
      organization_id: string;
      member_id: string;
      kind: string;
      content: string;
      metadata: string;
      created_at: string;
    }[];

    expect(memories).toHaveLength(1);
    expect(memories[0]?.id).toBe('self-msg-1');
    expect(memories[0]?.organization_id).toBe('org-1');
    expect(memories[0]?.member_id).toBe('alice');
    expect(memories[0]?.kind).toBe('fact');
    expect(memories[0]?.content).toBe('Remember to delete the scheduler.');
    expect(JSON.parse(memories[0]?.metadata || '{}')).toEqual({ migratedFromSelfNote: true });
    expect(memories[0]?.created_at).toBe('2026-04-27T08:01:00Z');

    upgraded.close();
  });
});
