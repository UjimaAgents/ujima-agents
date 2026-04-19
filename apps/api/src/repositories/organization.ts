import type { Database } from "bun:sqlite";
import { OrganizationSchema, type Organization } from "@ujima/shared";
import { now, parseJsonObject, rowString } from "./common.ts";

type Row = Record<string, unknown>;

export function getOrganization(db: Database, organizationId: string): Organization | null {
  const row = db.query("SELECT * FROM organizations WHERE id = ?").get(organizationId) as Row | null;
  if (!row) {
    return null;
  }

  return OrganizationSchema.parse({
    id: rowString(row, "id"),
    name: rowString(row, "name"),
    workspace: {
      root: rowString(row, "workspace_root"),
      roleScopes: parseJsonObject(row.workspace_role_scopes),
    },
  });
}

export function getLatestOrganization(db: Database): Organization | null {
  const row = db.query("SELECT id FROM organizations ORDER BY updated_at DESC LIMIT 1").get() as Row | null;
  if (!row) {
    return null;
  }

  return getOrganization(db, rowString(row, "id"));
}

export function saveOrganization(db: Database, organization: Organization): Organization {
  db.run(
    `
    INSERT INTO organizations (id, name, workspace_root, workspace_role_scopes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      workspace_root = excluded.workspace_root,
      workspace_role_scopes = excluded.workspace_role_scopes,
      updated_at = excluded.updated_at
    `,
    [
      organization.id,
      organization.name,
      organization.workspace.root,
      JSON.stringify(organization.workspace.roleScopes),
      now(),
      now(),
    ],
  );

  return organization;
}

export function saveProviderCredential(db: Database, organizationId: string, providerName: string, apiKey: string) {
  db.run(
    `
    INSERT INTO provider_credentials (organization_id, provider_name, api_key, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(organization_id, provider_name) DO UPDATE SET
      api_key = excluded.api_key,
      updated_at = excluded.updated_at
    `,
    [organizationId, providerName, apiKey, now()],
  );
}

export function listProviderCredentials(db: Database, organizationId: string): Record<string, boolean> {
  const rows = db
    .query("SELECT provider_name FROM provider_credentials WHERE organization_id = ?")
    .all(organizationId) as Array<{ provider_name: string }>;

  return Object.fromEntries(rows.map((row) => [row.provider_name, true]));
}

export function getProviderCredential(
  db: Database,
  organizationId: string,
  providerName: string,
): string | null {
  const row = db
    .query("SELECT api_key FROM provider_credentials WHERE organization_id = ? AND provider_name = ?")
    .get(organizationId, providerName) as Row | null;

  return row ? rowString(row, "api_key") : null;
}

