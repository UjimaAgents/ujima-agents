import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

interface StatementHandle {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number };
}

export interface DbHandle {
  prepare(sql: string): StatementHandle;
  exec(sql: string): void;
  pragma(sql: string): unknown;
  close(): void;
}

const MIGRATIONS: { id: string; up: string }[] = [
  {
    id: '001_initial',
    up: `
      CREATE TABLE IF NOT EXISTS context_entries (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_context_updated ON context_entries(updated_at);

      CREATE TABLE IF NOT EXISTS audit_events (
        id            TEXT PRIMARY KEY,
        event_id      TEXT NOT NULL,
        event_type    TEXT NOT NULL,
        agent_id      TEXT NOT NULL,
        task_id       TEXT NOT NULL,
        session_id    TEXT NOT NULL,
        tool_name     TEXT,
        tool_input    TEXT,
        tool_output   TEXT,
        allowed       INTEGER NOT NULL,
        block_reason  TEXT,
        tokens_used   INTEGER,
        duration_ms   INTEGER,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_agent   ON audit_events(agent_id);
      CREATE INDEX IF NOT EXISTS idx_audit_task    ON audit_events(task_id);
      CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);

      CREATE TABLE IF NOT EXISTS agent_state (
        agent_id        TEXT PRIMARY KEY,
        status          TEXT NOT NULL,
        last_action     TEXT,
        last_heartbeat  INTEGER,
        tokens_used     INTEGER NOT NULL DEFAULT 0,
        calls_made      INTEGER NOT NULL DEFAULT 0,
        updated_at      INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_state (
        task_id     TEXT PRIMARY KEY,
        status      TEXT NOT NULL,
        started_at  INTEGER NOT NULL,
        ended_at    INTEGER,
        metadata    TEXT
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id            TEXT PRIMARY KEY,
        task_id       TEXT NOT NULL,
        artifact_key  TEXT NOT NULL,
        domain        TEXT NOT NULL,
        status        TEXT NOT NULL,
        proposed_by   TEXT,
        approved_by   TEXT,
        decided_at    INTEGER,
        reason        TEXT,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_task   ON approvals(task_id);
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);

      CREATE TABLE IF NOT EXISTS pending_events (
        id             TEXT PRIMARY KEY,
        channel        TEXT NOT NULL,
        event_payload  TEXT NOT NULL,
        created_at     INTEGER NOT NULL,
        expires_at     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pending_channel ON pending_events(channel);
      CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_events(expires_at);

      CREATE TABLE IF NOT EXISTS schema_migrations (
        id        TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: '002_workspaces',
    up: `
      CREATE TABLE IF NOT EXISTS workspaces (
        id          TEXT PRIMARY KEY,
        root_path   TEXT,
        label       TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workspaces_root ON workspaces(root_path);

      CREATE TABLE IF NOT EXISTS runtime_state (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  INTEGER NOT NULL
      );
    `,
  },
  {
    id: '003_org_mode_core',
    up: `
      ALTER TABLE audit_events RENAME TO task_audit_events;
      ALTER TABLE approvals    RENAME TO task_approvals;

      CREATE TABLE IF NOT EXISTS organizations (
        id                       TEXT PRIMARY KEY,
        name                     TEXT NOT NULL,
        workspace_root           TEXT NOT NULL,
        workspace_role_scopes    TEXT NOT NULL DEFAULT '{}',
        organization_chart_json  TEXT NOT NULL DEFAULT '{"reportsTo":{}}',
        created_at               TEXT NOT NULL,
        updated_at               TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_settings (
        organization_id  TEXT NOT NULL,
        key              TEXT NOT NULL,
        value            TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        PRIMARY KEY (organization_id, key)
      );

      CREATE TABLE IF NOT EXISTS members (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        name             TEXT NOT NULL,
        kind             TEXT NOT NULL,
        role_name        TEXT NOT NULL,
        presence         TEXT NOT NULL DEFAULT 'offline',
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_members_org ON members(organization_id);

      CREATE TABLE IF NOT EXISTS channels (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        name             TEXT NOT NULL,
        kind             TEXT NOT NULL,
        topic            TEXT NOT NULL DEFAULT '',
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_channels_org ON channels(organization_id);

      CREATE TABLE IF NOT EXISTS channel_members (
        channel_id  TEXT NOT NULL,
        member_id   TEXT NOT NULL,
        PRIMARY KEY (channel_id, member_id)
      );

      CREATE TABLE IF NOT EXISTS threads (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        channel_id       TEXT,
        title            TEXT NOT NULL DEFAULT '',
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_threads_org     ON threads(organization_id);
      CREATE INDEX IF NOT EXISTS idx_threads_channel ON threads(channel_id);

      CREATE TABLE IF NOT EXISTS thread_members (
        thread_id  TEXT NOT NULL,
        member_id  TEXT NOT NULL,
        PRIMARY KEY (thread_id, member_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        thread_id        TEXT NOT NULL,
        channel_id       TEXT,
        sender_id        TEXT NOT NULL,
        sender_kind      TEXT NOT NULL,
        kind             TEXT NOT NULL,
        content          TEXT NOT NULL,
        mentions         TEXT NOT NULL DEFAULT '[]',
        created_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread  ON messages(thread_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_org     ON messages(organization_id);

      CREATE TABLE IF NOT EXISTS runs (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        agent_id         TEXT NOT NULL,
        thread_id        TEXT,
        status           TEXT NOT NULL,
        step             TEXT NOT NULL DEFAULT '',
        summary          TEXT NOT NULL DEFAULT '',
        started_at       TEXT NOT NULL,
        ended_at         TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_org ON runs(organization_id, started_at);

      CREATE TABLE IF NOT EXISTS approvals (
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
        resolved_at      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_org     ON approvals(organization_id, status);
      CREATE INDEX IF NOT EXISTS idx_approvals_run     ON approvals(run_id);

      CREATE TABLE IF NOT EXISTS audit_events (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        actor_id         TEXT,
        action           TEXT NOT NULL,
        target_type      TEXT NOT NULL,
        target_id        TEXT,
        status           TEXT NOT NULL DEFAULT 'ok',
        metadata         TEXT NOT NULL DEFAULT '{}',
        created_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_events_org ON audit_events(organization_id, created_at);

      CREATE TABLE IF NOT EXISTS memory_entries (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        member_id        TEXT,
        kind             TEXT NOT NULL,
        content          TEXT NOT NULL,
        metadata         TEXT NOT NULL DEFAULT '{}',
        created_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_entries_org ON memory_entries(organization_id);

      CREATE TABLE IF NOT EXISTS provider_credentials (
        organization_id  TEXT NOT NULL,
        provider_name    TEXT NOT NULL,
        key_ref          TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        PRIMARY KEY (organization_id, provider_name)
      );

      CREATE TABLE IF NOT EXISTS tool_activity (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        run_id           TEXT NOT NULL,
        tool_id          TEXT NOT NULL,
        action           TEXT NOT NULL,
        input            TEXT NOT NULL,
        output           TEXT,
        status           TEXT NOT NULL,
        created_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tool_activity_run ON tool_activity(run_id, created_at);
    `,
  },
  {
    id: '004_additive_ports',
    up: `
      ALTER TABLE messages ADD COLUMN tool_calls TEXT NOT NULL DEFAULT '[]';

      CREATE TABLE IF NOT EXISTS workspace_members (
        organization_id   TEXT NOT NULL,
        member_id         TEXT NOT NULL,
        role_scope_paths  TEXT NOT NULL DEFAULT '[]',
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        PRIMARY KEY (organization_id, member_id)
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_members_org ON workspace_members(organization_id);

      CREATE TABLE IF NOT EXISTS todos (
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
      CREATE INDEX IF NOT EXISTS idx_todos_org    ON todos(organization_id, status);
      CREATE INDEX IF NOT EXISTS idx_todos_run    ON todos(run_id);
      CREATE INDEX IF NOT EXISTS idx_todos_member ON todos(member_id);

      CREATE TABLE IF NOT EXISTS provider_bindings (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        provider         TEXT NOT NULL,
        model            TEXT NOT NULL,
        scope            TEXT NOT NULL DEFAULT 'workspace',
        scope_ref        TEXT,
        api_key_ref      TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_provider_bindings_org
        ON provider_bindings(organization_id, provider);
    `,
  },
  {
    id: '005_config_reconcile',
    up: `
      ALTER TABLE members ADD COLUMN retired_at TEXT;
      ALTER TABLE channels ADD COLUMN archived_at TEXT;

      CREATE TABLE IF NOT EXISTS config_field_ownership (
        organization_id          TEXT NOT NULL,
        entity_type              TEXT NOT NULL,
        entity_id                TEXT NOT NULL,
        field_name               TEXT NOT NULL,
        owner                    TEXT NOT NULL DEFAULT 'dashboard',
        allow_dashboard_override INTEGER NOT NULL DEFAULT 0,
        updated_at               TEXT NOT NULL,
        PRIMARY KEY (organization_id, entity_type, entity_id, field_name)
      );
      CREATE INDEX IF NOT EXISTS idx_config_field_ownership_org
        ON config_field_ownership(organization_id, entity_type, entity_id);
    `,
  },
];

export interface DbOptions {
  dbPath: string;
}

export function openDatabase(options: DbOptions): DbHandle {
  if (options.dbPath !== ':memory:') {
    mkdirSync(dirname(options.dbPath), { recursive: true });
  }

  const db = new Database(options.dbPath) as unknown as DbHandle;

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db);
  return db;
}

function runMigrations(db: DbHandle): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const select = db.prepare('SELECT id FROM schema_migrations');
  const applied = new Set((select.all() as { id: string }[]).map((row) => row.id));
  const insert = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');

  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.up);
      insert.run(m.id, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function nowMs(): number {
  return Date.now();
}
