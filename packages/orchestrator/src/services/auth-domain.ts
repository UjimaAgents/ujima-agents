import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import { AuthService } from './auth.js';
import { BootstrapService } from './bootstrap.js';
import { PluginRegistryService } from './plugin-registry.js';
import { DEFAULT_SKILL_URLS, OnboardingService } from './onboarding.js';
import { WorkspaceService, type WorkspaceCatalog } from './workspace.js';

export interface AuthDomainInput {
  repo: ApiRepository;
  teamStore: TeamStore;
  workspaces: WorkspaceCatalog;
  archiveRoot: string;
}

export interface AuthDomainOutput {
  auth: AuthService;
  bootstrap: BootstrapService;
  onboarding: OnboardingService;
  workspaces: WorkspaceService;
  pluginRegistry: PluginRegistryService;
  getOrganizationIdsForSweep: () => string[];
  probeIds: string[];
}

export function createAuthDomain(input: AuthDomainInput): AuthDomainOutput {
  const auth = new AuthService(input.repo);
  const bootstrap = new BootstrapService(input.repo, input.teamStore, auth);
  const pluginRegistry = new PluginRegistryService(
    input.repo,
    input.archiveRoot,
  );
  const onboarding = new OnboardingService(input.repo, input.teamStore, pluginRegistry);
  const getOrganizationIdsForSweep: () => string[] = () =>
    input.repo.listOrganizations().map((org) => org.id);
  const probeIds = getOrganizationIdsForSweep();
  if (!Array.isArray(probeIds)) {
    throw new Error(
      'ApiServicesContext.repo.listOrganizations must return an array of organizations',
    );
  }

  // Seed default skills for orgs missing any DEFAULT_SKILL_URLS entry.
  void (async () => {
    if (!pluginRegistry) return;
    for (const orgId of probeIds) {
      for (const url of DEFAULT_SKILL_URLS) {
        try {
          const existing =
            input.repo.getPluginInstallBySourceUrl?.(orgId, url) ?? null;
          if (existing) continue;
          await pluginRegistry.installFromUrl({
            organizationId: orgId,
            createdBy: '__startup_sweep__',
            sourceUrl: url,
          });
        } catch (err) {
          console.warn(
            `[startup] failed to seed default skill from ${url} for org ${orgId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  })();

  const workspaces = new WorkspaceService(
    input.repo,
    input.teamStore,
    input.workspaces,
    auth,
  );

  return {
    auth,
    bootstrap,
    onboarding,
    workspaces,
    pluginRegistry,
    getOrganizationIdsForSweep,
    probeIds,
  };
}
