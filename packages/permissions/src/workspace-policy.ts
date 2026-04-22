import { GovernancePolicy, emptyGovernancePolicy } from '@ujima/shared';

/**
 * File-format layer for `.ujima/governance.json`. Pure TS — the plugin passes
 * in read/write functions bound to `vscode.workspace.fs`, so this module is
 * equally usable from a node test harness.
 */
export interface WorkspacePolicyAdapter {
  read(): Promise<Uint8Array | undefined>;
  write(bytes: Uint8Array): Promise<void>;
}

export interface WorkspacePolicyStore {
  load(): Promise<GovernancePolicy>;
  save(policy: GovernancePolicy): Promise<GovernancePolicy>;
  mutate(
    fn: (policy: GovernancePolicy) => GovernancePolicy | Promise<GovernancePolicy>,
  ): Promise<GovernancePolicy>;
  current(): GovernancePolicy;
  onChange(listener: (policy: GovernancePolicy) => void): () => void;
}

export function createWorkspacePolicyStore(
  adapter: WorkspacePolicyAdapter,
): WorkspacePolicyStore {
  let cached: GovernancePolicy = emptyGovernancePolicy();
  const listeners = new Set<(policy: GovernancePolicy) => void>();

  function emit(): void {
    for (const l of listeners) {
      try {
        l(cached);
      } catch {
        // listener errors must not break enforcement
      }
    }
  }

  return {
    async load() {
      const bytes = await adapter.read();
      if (!bytes || bytes.length === 0) {
        cached = emptyGovernancePolicy();
        emit();
        return cached;
      }
      try {
        const parsed = GovernancePolicy.parse(
          JSON.parse(new TextDecoder().decode(bytes)),
        );
        cached = parsed;
      } catch {
        cached = emptyGovernancePolicy();
      }
      emit();
      return cached;
    },

    async save(policy) {
      const normalized = GovernancePolicy.parse({
        ...policy,
        updated_at: new Date().toISOString(),
      });
      cached = normalized;
      await adapter.write(
        new TextEncoder().encode(`${JSON.stringify(normalized, null, 2)}\n`),
      );
      emit();
      return cached;
    },

    async mutate(fn) {
      const next = await fn(cached);
      return this.save(next);
    },

    current() {
      return cached;
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
