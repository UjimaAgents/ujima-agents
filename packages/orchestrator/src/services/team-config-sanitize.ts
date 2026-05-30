export function stripProvisioningAgentsFromTeamConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...config,
    agents: [],
    organizationChart: { reportsTo: {} },
  };
}
