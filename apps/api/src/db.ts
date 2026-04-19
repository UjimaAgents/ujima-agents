import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveDatabasePath } from "./config.ts";

function ensureColumn(db: Database, table: string, column: string, definition: string) {
  const columns = db
    .query(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;

  if (!columns.some((entry) => entry.name === column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function initDatabase(dbPath = resolveDatabasePath()) {
  const absolutePath = resolveDatabasePath(dbPath);
  mkdirSync(dirname(absolutePath), { recursive: true });

  const db = new Database(absolutePath);
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA synchronous = NORMAL;");
  db.run("PRAGMA foreign_keys = ON;");

  db.run(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      workspace_role_scopes TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS workspace_settings (
      organization_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, key)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      role_name TEXT NOT NULL,
      presence TEXT NOT NULL DEFAULT 'offline',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS channel_members (
      channel_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      PRIMARY KEY (channel_id, member_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      channel_id TEXT,
      title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS thread_members (
      thread_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      PRIMARY KEY (thread_id, member_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      channel_id TEXT,
      sender_id TEXT NOT NULL,
      sender_kind TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      mentions TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      thread_id TEXT,
      status TEXT NOT NULL,
      step TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      ended_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      run_id TEXT,
      requested_by TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_path TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      actor_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      status TEXT NOT NULL DEFAULT 'ok',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      member_id TEXT,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS provider_credentials (
      organization_id TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      api_key TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, provider_name)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tool_activity (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      action TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  ensureColumn(db, "organizations", "workspace_role_scopes", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "organizations", "updated_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "workspace_settings", "updated_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "members", "updated_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "channels", "updated_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "threads", "updated_at", "TEXT NOT NULL DEFAULT ''");
  return db;
}
