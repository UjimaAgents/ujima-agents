import { join } from 'node:path';

export const REPO_ROOT = join(import.meta.dir, '../../..');
export const DIST_PKG_DIR = join(REPO_ROOT, 'packages/distribution');
export const DIST_OUT_DIR = join(DIST_PKG_DIR, 'dist');
export const RUNTIME_DIR = join(DIST_OUT_DIR, 'runtime');
export const API_RUNTIME_DIR = join(RUNTIME_DIR, 'api');
export const WEB_RUNTIME_DIR = join(RUNTIME_DIR, 'web');

export const DISTRIBUTION_PKG_JSON = join(DIST_PKG_DIR, 'package.json');
export const CHANGELOG_PATH = join(REPO_ROOT, 'CHANGELOG.md');
export const LICENSE_PATH = join(REPO_ROOT, 'LICENSE');
export const README_PATH = join(REPO_ROOT, 'README.md');
