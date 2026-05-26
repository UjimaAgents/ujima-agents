import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import {
  PluginInstallSchema,
  SkillInstallSchema,
  type PluginInstall,
  type SkillInstall,
} from '@ujima/shared';
import { rowString } from './common.js';

type Row = Record<string, unknown>;

function queryOne<T>(db: DbHandle, sql: string, params: unknown[], map: (row: Row) => T): T | null {
  const row = db.prepare(sql).get(...params) as Row | null;
  return row ? map(row) : null;
}

function queryAll<T>(db: DbHandle, sql: string, params: unknown[], map: (row: Row) => T): T[] {
  return (db.prepare(sql).all(...params) as Row[]).map(map);
}

function rowToInstall(row: Row): PluginInstall {
  return PluginInstallSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    pluginId: rowString(row, 'plugin_id'),
    pluginName: rowString(row, 'plugin_name'),
    version: rowString(row, 'version'),
    sourceUrl: rowString(row, 'source_url'),
    localPath: rowString(row, 'local_path'),
    status: rowString(row, 'status'),
    createdBy: rowString(row, 'created_by'),
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
  });
}

function rowToSkillInstall(row: Row): SkillInstall {
  return SkillInstallSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    pluginInstallId: rowString(row, 'plugin_install_id'),
    pluginId: rowString(row, 'plugin_id'),
    pluginName: rowString(row, 'plugin_name'),
    skillName: rowString(row, 'skill_name'),
    commandName: rowString(row, 'command_name'),
    description: rowString(row, 'description'),
    userInvocable: Boolean(row.user_invocable),
    disableModelInvocation: Boolean(row.disable_model_invocation),
    skillPath: rowString(row, 'skill_path'),
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
  });
}

export function savePluginInstall(db: DbHandle, install: PluginInstall): PluginInstall {
  const payload = PluginInstallSchema.parse(install);
  db.prepare(
    `INSERT INTO plugin_installs (
       id, organization_id, plugin_id, plugin_name, version, source_url,
       local_path, status, created_by, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, source_url) DO UPDATE SET
       plugin_id = excluded.plugin_id,
       plugin_name = excluded.plugin_name,
       version = excluded.version,
       local_path = excluded.local_path,
       status = excluded.status,
       updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.pluginId,
    payload.pluginName,
    payload.version,
    payload.sourceUrl,
    payload.localPath,
    payload.status,
    payload.createdBy,
    payload.createdAt,
    payload.updatedAt,
  );
  return payload;
}

export function getPluginInstall(
  db: DbHandle,
  organizationId: string,
  installId: string,
): PluginInstall | null {
  return queryOne(
    db,
    'SELECT * FROM plugin_installs WHERE organization_id = ? AND id = ?',
    [organizationId, installId],
    rowToInstall,
  );
}

export function getPluginInstallBySourceUrl(
  db: DbHandle,
  organizationId: string,
  sourceUrl: string,
): PluginInstall | null {
  return queryOne(
    db,
    'SELECT * FROM plugin_installs WHERE organization_id = ? AND source_url = ?',
    [organizationId, sourceUrl],
    rowToInstall,
  );
}

export function listPluginInstalls(db: DbHandle, organizationId: string): PluginInstall[] {
  return queryAll(
    db,
    `SELECT * FROM plugin_installs
     WHERE organization_id = ?
     ORDER BY created_at DESC`,
    [organizationId],
    rowToInstall,
  );
}

export function deletePluginInstall(db: DbHandle, organizationId: string, installId: string): void {
  db.prepare('DELETE FROM organization_skill_installs WHERE organization_id = ? AND plugin_install_id = ?').run(
    organizationId,
    installId,
  );
  db.prepare('DELETE FROM plugin_installs WHERE organization_id = ? AND id = ?').run(organizationId, installId);
}

export function saveOrganizationSkillInstall(db: DbHandle, install: SkillInstall): SkillInstall {
  const payload = SkillInstallSchema.parse(install);
  db.prepare(
    `INSERT INTO organization_skill_installs (
       id, organization_id, plugin_install_id, plugin_id, plugin_name,
       skill_name, command_name, description, user_invocable,
       disable_model_invocation, skill_path, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, plugin_install_id, skill_name) DO UPDATE SET
       command_name = excluded.command_name,
       description = excluded.description,
       user_invocable = excluded.user_invocable,
       disable_model_invocation = excluded.disable_model_invocation,
       skill_path = excluded.skill_path,
       updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.pluginInstallId,
    payload.pluginId,
    payload.pluginName,
    payload.skillName,
    payload.commandName,
    payload.description,
    payload.userInvocable ? 1 : 0,
    payload.disableModelInvocation ? 1 : 0,
    payload.skillPath,
    payload.createdAt,
    payload.updatedAt,
  );
  return payload;
}

export function getOrganizationSkillInstall(
  db: DbHandle,
  organizationId: string,
  installId: string,
): SkillInstall | null {
  return queryOne(
    db,
    'SELECT * FROM organization_skill_installs WHERE organization_id = ? AND id = ?',
    [organizationId, installId],
    rowToSkillInstall,
  );
}

export function listOrganizationSkillInstalls(db: DbHandle, organizationId: string): SkillInstall[] {
  return queryAll(
    db,
    `SELECT * FROM organization_skill_installs
     WHERE organization_id = ?
     ORDER BY plugin_name ASC, skill_name ASC`,
    [organizationId],
    rowToSkillInstall,
  );
}

export function deleteOrganizationSkillInstall(
  db: DbHandle,
  organizationId: string,
  installId: string,
): void {
  db.prepare('DELETE FROM organization_skill_installs WHERE organization_id = ? AND id = ?').run(
    organizationId,
    installId,
  );
}

export function createPluginRepository(db: DbHandle) {
  return {
    savePluginInstall: (install: PluginInstall) => savePluginInstall(db, install),
    getPluginInstall: (organizationId: string, installId: string) =>
      getPluginInstall(db, organizationId, installId),
    getPluginInstallBySourceUrl: (organizationId: string, sourceUrl: string) =>
      getPluginInstallBySourceUrl(db, organizationId, sourceUrl),
    listPluginInstalls: (organizationId: string) => listPluginInstalls(db, organizationId),
    deletePluginInstall: (organizationId: string, installId: string) =>
      deletePluginInstall(db, organizationId, installId),
    saveOrganizationSkillInstall: (install: SkillInstall) => saveOrganizationSkillInstall(db, install),
    getOrganizationSkillInstall: (organizationId: string, installId: string) =>
      getOrganizationSkillInstall(db, organizationId, installId),
    listOrganizationSkillInstalls: (organizationId: string) =>
      listOrganizationSkillInstalls(db, organizationId),
    deleteOrganizationSkillInstall: (organizationId: string, installId: string) =>
      deleteOrganizationSkillInstall(db, organizationId, installId),
  };
}

export type PluginRepository = ReturnType<typeof createPluginRepository>;
