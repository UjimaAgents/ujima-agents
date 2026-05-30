/**
 * When provisioning a new organization from an existing team config (workspace split,
 * etc.), do not clone agent members or reporting edges — only structure the user
 * adds agents for explicitly.
 */
export function stripProvisioningAgentsFromTeamConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...config,
    agents: [],
    organizationChart: { reportsTo: {} },
  };
}
