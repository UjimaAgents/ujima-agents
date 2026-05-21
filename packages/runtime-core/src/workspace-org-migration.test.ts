import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAgentTeam } from '@ujima/framework';
import { MemberSchema, OrganizationSchema } from '@ujima/shared';
import {
  ACTIVE_WORKSPACE_SETTING_KEY,
  createTeamStore,
  persistTeamConfig,
} from '@ujima/orchestrator';
import { createBufferLogger } from './logger.js';
import { Repository } from './repositories/index.js';
import { createRuntimeHost, type RuntimeHost } from './runtime-host.js';
import {
  migrateUnifiedWorkspaceOrg,
  ORGANIZATION_WORKSPACE_IDS_KEY,
} from './workspace-org-migration.js';

describe('migrateUnifiedWorkspaceOrg', () => {
  let homeDir: string;
  let primaryDir: string;
  let secondaryDir: string;
  let host: RuntimeHost;
  let repo: Repository;

  beforeAll(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'ujima-ws-migration-'));
    primaryDir = await mkdtemp(join(tmpdir(), 'ujima-ws-primary-'));
    secondaryDir = await mkdtemp(join(tmpdir(), 'ujima-ws-secondary-'));

    host = await createRuntimeHost(
      {
        homeDir,
        logger: createBufferLogger(),
        loadAgent: async () => undefined,
        loadTeam: async () => undefined,
        resolveMCPDef: async (_w: string, id: string) => {
          throw new Error(`no mcp ${id}`);
        },
        getModel: () => {
          throw new Error('no model configured');
        },
      },
      {},
    );
    repo = new Repository(host.db.raw);
  }, 20_000);

  afterAll(async () => {
    if (host) await host.shutdown({ drainMs: 500 });
    for (const dir of [homeDir, primaryDir, secondaryDir]) {
      if (!dir) continue;
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('splits extra linked workspaces into new organizations and cleans legacy settings', () => {
    const organizationId = 'org-multi-ws';
    const defaultWorkspaceId = `ws_${organizationId}`;

    const organization = OrganizationSchema.parse({
      id: organizationId,
      name: 'Parent Org',
      workspace: { root: primaryDir, roleScopes: {} },
      organizationChart: { reportsTo: {} },
    });
    repo.saveOrganization(organization);

    const team = loadAgentTeam({
      name: 'Parent Org',
      workspace: { root: primaryDir },
      roles: [
        {
          name: 'lead',
          title: 'Lead',
          instructions: 'Lead the work.',
          tools: [],
        },
      ],
      agents: [{ name: 'lead', roleName: 'lead' }],
      channels: [],
      providers: {},
    });
    persistTeamConfig(repo, organizationId, team);

    const ownerMember = MemberSchema.parse({
      id: 'owner-member',
      organizationId,
      name: 'Owner',
      kind: 'human',
      roleName: 'owner',
      presence: 'offline',
    });
    repo.saveMember(ownerMember);
    repo.saveAuthUser({
      user: {
        id: 'auth-user-1',
        organizationId,
        memberId: ownerMember.id,
        email: 'owner@example.com',
        createdAt: new Date().toISOString(),
      },
      passwordHash: 'hash',
      emailNormalized: 'owner@example.com',
    });

    host.workspaces.create({
      id: defaultWorkspaceId,
      root_path: primaryDir,
      label: 'Primary',
    });
    const secondary = host.workspaces.create({
      root_path: secondaryDir,
      label: 'Secondary Folder',
    });

    repo.saveWorkspaceSetting(
      organizationId,
      ORGANIZATION_WORKSPACE_IDS_KEY,
      JSON.stringify([defaultWorkspaceId, secondary.id]),
    );
    repo.saveWorkspaceSetting(organizationId, ACTIVE_WORKSPACE_SETTING_KEY, secondary.id);

    const teamStore = createTeamStore();
    const result = migrateUnifiedWorkspaceOrg({
      repo,
      teamStore,
      workspaces: host.workspaces,
    });

    expect(result.splits).toHaveLength(1);
    expect(result.splits[0]?.fromOrganizationId).toBe(organizationId);
    expect(result.splits[0]?.workspaceId).toBe(secondary.id);

    const orgs = repo.listOrganizations();
    expect(orgs.length).toBe(2);

    const parent = repo.getOrganization(organizationId);
    expect(parent?.workspace.root).toBe(primaryDir);
    expect(repo.getWorkspaceSetting(organizationId, ACTIVE_WORKSPACE_SETTING_KEY)).toBeNull();
    expect(repo.getWorkspaceSetting(organizationId, ORGANIZATION_WORKSPACE_IDS_KEY)).toBeNull();

    const newOrgId = result.splits[0]?.toOrganizationId;
    expect(newOrgId).toBeTruthy();
    const child = repo.getOrganization(newOrgId!);
    expect(child?.workspace.root).toBe(secondaryDir);
    expect(child?.name).toBe('Secondary Folder');

    const childOwner = repo.listMembers(newOrgId!).find((m: { roleName: string }) => m.roleName === 'owner');
    expect(childOwner).toBeTruthy();
    const childAuth = repo.getAuthUserByMember(newOrgId!, childOwner!.id);
    expect(childAuth?.email).toBe('owner@example.com');
  });

  it('is idempotent when migration already ran', () => {
    const organizationId = 'org-idempotent';
    const organization = OrganizationSchema.parse({
      id: organizationId,
      name: 'Single Org',
      workspace: { root: primaryDir, roleScopes: {} },
      organizationChart: { reportsTo: {} },
    });
    repo.saveOrganization(organization);

    const teamStore = createTeamStore();
    migrateUnifiedWorkspaceOrg({ repo, teamStore, workspaces: host.workspaces });
    const second = migrateUnifiedWorkspaceOrg({ repo, teamStore, workspaces: host.workspaces });

    expect(second.splits).toHaveLength(0);
  });
});
