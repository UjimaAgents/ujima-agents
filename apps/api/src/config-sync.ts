import { watch, type FSWatcher } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import type { Logger, Repository } from '@ujima/runtime-core';
import { resolveTeamConfigPath } from '@ujima/runtime-core';
import { ConfigSyncService, type TeamStore } from '@ujima/orchestrator';

export interface TeamConfigWatcher {
  close(): void;
}

function watchDirectory(): { dir: string; explicitFileName?: string } {
  const fromEnv = process.env.UJIMA_TEAM_CONFIG ?? process.env.UJIMA_CONFIG_FILE;
  if (!fromEnv || fromEnv.trim() === '') {
    return { dir: process.cwd() };
  }

  const resolved = resolve(fromEnv);
  return {
    dir: dirname(resolved),
    explicitFileName: basename(resolved),
  };
}

function shouldHandleFileChange(
  fileName: string | Buffer | null,
  explicitFileName?: string,
): boolean {
  if (!fileName) {
    return true;
  }

  const value = fileName.toString();
  if (explicitFileName) {
    return value === explicitFileName;
  }

  return value === 'ujima.config.ts' || value === 'ujima.config.js';
}

export async function startTeamConfigWatcher(options: {
  repo: Repository;
  teamStore: TeamStore;
  logger: Logger;
}): Promise<TeamConfigWatcher> {
  const logger = options.logger.child({ component: 'config-sync' });
  const syncService = new ConfigSyncService(options.repo, options.teamStore);
  let boundOrganizationId: string | undefined;

  const runSync = async (): Promise<void> => {
    const configPath = resolveTeamConfigPath();
    if (!configPath) {
      const stored = syncService.loadFromStoredConfig(boundOrganizationId);
      if (stored) {
        boundOrganizationId = stored.organizationId;
        logger.info(stored.inferred ? 'team config inferred from repository' : 'team config loaded from repository', {
          organizationId: stored.organizationId,
        });
      } else {
        logger.info('team config not found');
      }
      return;
    }

    try {
      const result = await syncService.loadAndReconcileFromFile(
        configPath,
        boundOrganizationId,
      );
      boundOrganizationId = result.organization.id;
      logger.info('team config reconciled', {
        configPath,
        organizationId: result.organization.id,
        stats: result.stats,
      });
    } catch (error) {
      logger.error('team config reconcile failed', {
        configPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await runSync();

  const watchTarget = watchDirectory();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;

  try {
    watcher = watch(watchTarget.dir, (eventType, fileName) => {
      if (eventType !== 'change' && eventType !== 'rename') {
        return;
      }
      if (!shouldHandleFileChange(fileName, watchTarget.explicitFileName)) {
        return;
      }

      if (timer) {
        clearTimeout(timer);
      }
      // Editors often emit multiple fs events for a single save. Debouncing
      // keeps the reconcile loop from reloading the same config repeatedly.
      timer = setTimeout(() => {
        void runSync();
      }, 50);
    });
  } catch (error) {
    logger.warn('team config watcher disabled', {
      dir: watchTarget.dir,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    close() {
      if (timer) {
        clearTimeout(timer);
      }
      watcher?.close();
    },
  };
}
