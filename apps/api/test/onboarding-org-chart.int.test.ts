import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import { Repository } from '@ujima/runtime-core';
import { OnboardingService, createTeamStore } from '@ujima/orchestrator';

// Regression: buildOnboardingPayload() in the web onboarding flow used
// to drop every organizationReports entry whose manager wasn't a known
// role name. The owner appears in the manager picker as a label
// (`draft.ownerName.trim() || "Owner"`), so any "X reports to <owner>"
// edge silently disappeared before reaching the daemon.
//
// Fix is two-sided:
//   * web/onboarding-experience.tsx — keep owner-targeting reports.
//   * orchestrator/onboarding.ts — pre-allocate ownerId, split owner
//     refs off before loadAgentTeam (the framework only resolves agent
//     refs and would throw otherwise), then merge them back in with the
//     resolved ownerId.
//
// These tests cover the backend half: every owner-label form the web
// payload may carry must resolve to the owner member's id.
describe('OnboardingService.onboard — owner-targeting org-chart edges', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup() {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'ujima-onboarding-orgchart-'));
    tempDirs.push(workspaceRoot);
    const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
    const teamStore = createTeamStore();
    const service = new OnboardingService(repo, teamStore);
    return { service, workspaceRoot };
  }

  function teamWithReports(reportsTo: Record<string, string>) {
    return {
      channels: [{ name: 'general', kind: 'general' as const, topic: 'General' }],
      roles: [
        {
          name: 'product-manager',
          title: 'Product Manager',
          instructions: 'Lead product.',
          provider: 'openai',
          model: 'gpt-4.1',
          workspaceScopes: ['.'],
          channels: ['general'],
        },
        {
          name: 'frontend-engineer',
          title: 'Frontend Engineer',
          instructions: 'Build the UI.',
          provider: 'openai',
          model: 'gpt-4.1',
          workspaceScopes: ['.'],
          channels: ['general'],
        },
      ],
      agents: [
        { name: 'product-manager', roleName: 'product-manager' as const, personalityName: 'direct' as const },
        { name: 'frontend-engineer', roleName: 'frontend-engineer' as const, personalityName: 'direct' as const },
      ],
      providers: {
        openai: { kind: 'openai' as const, defaultModel: 'gpt-4.1', models: ['gpt-4.1'] },
      },
      organizationChart: { reportsTo },
    };
  }

  it("resolves the owner's display name in reportsTo to the owner member's id", async () => {
    const { service, workspaceRoot } = await setup();
    const result = await service.onboard({
      organizationName: 'Acme',
      ownerName: 'Caleb',
      ownerEmail: 'caleb@example.com',
      ownerPassword: 'correct horse battery staple',
      workspaceRoot,
      providerKeys: { openai: 'sk-test' },
      team: teamWithReports({
        // The web payload sends `Caleb` (the owner's display name) as the
        // manager. Pre-fix, the web side stripped this and the backend
        // never saw it; with both halves fixed it must round-trip and
        // resolve to the owner's member id.
        'product-manager': 'Caleb',
      }),
    });

    const owner = result.members.find((m) => m.kind === 'human');
    expect(owner).toBeDefined();
    const reportsTo = result.organization.organizationChart.reportsTo;
    expect(reportsTo['product-manager']).toBe(owner!.id);
  });

  it("resolves the literal 'Owner' sentinel from the web seed draft", async () => {
    const { service, workspaceRoot } = await setup();
    const result = await service.onboard({
      organizationName: 'Acme',
      ownerName: 'Caleb',
      ownerEmail: 'caleb@example.com',
      ownerPassword: 'correct horse battery staple',
      workspaceRoot,
      providerKeys: { openai: 'sk-test' },
      team: teamWithReports({
        'product-manager': 'Owner',
      }),
    });

    const owner = result.members.find((m) => m.kind === 'human');
    expect(result.organization.organizationChart.reportsTo['product-manager']).toBe(owner!.id);
  });

  it('preserves agent-only edges alongside owner-targeting edges', async () => {
    const { service, workspaceRoot } = await setup();
    const result = await service.onboard({
      organizationName: 'Acme',
      ownerName: 'Caleb',
      ownerEmail: 'caleb@example.com',
      ownerPassword: 'correct horse battery staple',
      workspaceRoot,
      providerKeys: { openai: 'sk-test' },
      team: teamWithReports({
        // PM reports to owner; FE reports to PM.
        'product-manager': 'Caleb',
        'frontend-engineer': 'product-manager',
      }),
    });

    const owner = result.members.find((m) => m.kind === 'human');
    const reportsTo = result.organization.organizationChart.reportsTo;
    expect(reportsTo['product-manager']).toBe(owner!.id);
    expect(reportsTo['frontend-engineer']).toBe('product-manager');
  });

  it('still rejects unknown manager refs that are neither agents nor the owner', async () => {
    const { service, workspaceRoot } = await setup();
    await expect(
      service.onboard({
        organizationName: 'Acme',
        ownerName: 'Caleb',
        ownerEmail: 'caleb@example.com',
        ownerPassword: 'correct horse battery staple',
        workspaceRoot,
        providerKeys: { openai: 'sk-test' },
        team: teamWithReports({
          'product-manager': 'who-even-is-this',
        }),
      }),
    ).rejects.toThrow(/unknown parent agent/i);
  });
});
