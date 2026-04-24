import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// E0.3.3 — lint guard.
//
// After the AI SDK cutover, `@ujima/llm/legacy` is expected to survive in a
// small, known set of consumers: the legacy tool-loop + runner shell, the
// orchestrator's legacy plan/types surface, the API's legacy `getProvider`
// stub, and the VS Code extension's pre-thin-client plumbing.
//
// Any NEW file importing `@ujima/llm/legacy` outside this allowlist fails the
// test — it needs to either (a) migrate to `@ujima/llm` or (b) earn a spot on
// the allowlist with a reason.

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

// Paths that may legitimately import from '@ujima/llm/legacy'. Anything else
// should use '@ujima/llm' (the AI SDK surface).
const ALLOWED_LEGACY_CONSUMERS: readonly string[] = [
  // The legacy runner + shell path itself.
  'packages/agent-runtime/src/tool-loop.ts',
  'packages/agent-runtime/src/shell.ts',
  'packages/agent-runtime/src/runner.ts',
  'packages/agent-runtime/src/types.ts',
  'packages/agent-runtime/src/shell.test.ts',
  'packages/agent-runtime/src/concurrent.test.ts',
  'packages/agent-runtime/src/gate.test.ts',
  // Orchestrator legacy task path.
  'packages/orchestrator/src/plan.ts',
  'packages/orchestrator/src/types.ts',
  'packages/orchestrator/src/run-task.test.ts',
  // Runtime-core's getProvider factory (legacy).
  'packages/runtime-core/src/runtime-host.ts',
  'packages/runtime-core/src/runtime-host.test.ts',
  // Daemon's stub getProvider (legacy-shaped; dies with full AI SDK cutover).
  'apps/api/src/main.ts',
  'apps/api/test/transport.int.test.ts',
  // Extension (pre-thin-client).
  'apps/vscode-extension/src/onboard-agent.ts',
  'apps/vscode-extension/src/onboard-wizard-panel.ts',
  'apps/vscode-extension/src/task-runner.ts',
  'apps/vscode-extension/src/vscode-lm-provider.ts',
];

// Directories we skip (not code we own).
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.turbo',
  'coverage',
  '.next',
  'out',
]);

// Roots we scan.
const SCAN_ROOTS = ['packages', 'apps'];

function* walkSource(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkSource(full);
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
      yield full;
    }
  }
}

describe('E0.3.3 — legacy import guard', () => {
  test('every `@ujima/llm/legacy` import sits under the allowlist', () => {
    const offenders: string[] = [];

    for (const root of SCAN_ROOTS) {
      const absRoot = join(REPO_ROOT, root);
      for (const file of walkSource(absRoot)) {
        // Files under packages/llm/src/legacy/** are the legacy package
        // itself — it may reference its own internals freely.
        if (file.includes(`${'/'}packages${'/'}llm${'/'}src${'/'}legacy${'/'}`)) continue;

        const rel = file.slice(REPO_ROOT.length + 1);
        const src = readFileSync(file, 'utf8');

        const importsLegacy = /from\s+['"]@ujima\/llm\/legacy['"]/.test(src);
        if (!importsLegacy) continue;

        if (!ALLOWED_LEGACY_CONSUMERS.includes(rel)) {
          offenders.push(rel);
        }
      }
    }

    if (offenders.length > 0) {
      const message =
        'The following files import `@ujima/llm/legacy` but are not on the allowlist in legacy-quarantine.bun.test.ts:\n' +
        offenders.map((o) => `  - ${o}`).join('\n') +
        "\n\nMigrate them to `@ujima/llm` (AI SDK) or add them to ALLOWED_LEGACY_CONSUMERS with a justification.";
      throw new Error(message);
    }
  });

  test('nothing outside packages/llm/src/legacy/** imports from legacy submodules directly', () => {
    // Prevent bypasses like `from '@ujima/llm/legacy/anthropic'` — the subpath
    // export is `/legacy` only; deep imports would skirt the guard.
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      const absRoot = join(REPO_ROOT, root);
      for (const file of walkSource(absRoot)) {
        if (file.includes(`${'/'}packages${'/'}llm${'/'}src${'/'}legacy${'/'}`)) continue;
        const src = readFileSync(file, 'utf8');
        if (/from\s+['"]@ujima\/llm\/legacy\/[^'"]+['"]/.test(src)) {
          offenders.push(file.slice(REPO_ROOT.length + 1));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
