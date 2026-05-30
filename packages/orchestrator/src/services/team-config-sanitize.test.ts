import { describe, expect, it } from 'vitest';
import { stripProvisioningAgentsFromTeamConfig } from './team-config-sanitize.js';

describe('stripProvisioningAgentsFromTeamConfig', () => {
  it('clears agents and org chart edges while preserving other team fields', () => {
    const input = {
      name: 'Parent Team',
      agents: [{ name: 'pm', roleName: 'pm' }],
      organizationChart: { reportsTo: { 'frontend-engineer': 'pm' } },
      roles: [{ name: 'pm' }],
      channels: [{ name: 'general', kind: 'general' }],
    };

    expect(stripProvisioningAgentsFromTeamConfig(input)).toEqual({
      ...input,
      agents: [],
      organizationChart: { reportsTo: {} },
    });
  });
});
