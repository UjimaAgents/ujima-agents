import type { Organization } from "@ujima/shared";

export function requireOrganization(
  repo: { getOrganization: (organizationId: string) => Organization | null },
  organizationId: string,
): Organization {
  const org = repo.getOrganization(organizationId);
  if (!org) throw new Error(`Organization not found: ${organizationId}`);
  return org;
}
