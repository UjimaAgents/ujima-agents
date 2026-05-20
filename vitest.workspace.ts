import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*',
  'apps/web',
  'apps/vscode-extension',
  'apps/api',
  // api-schema + client-sdk ship alongside transport; their tests run under
  // apps/api/test since both require the daemon surface to be meaningful.
]);
