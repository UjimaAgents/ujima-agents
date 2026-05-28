import {
  type GovernancePolicy,
  type RiskDefaults,
  setRiskDefaults,
} from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

export class GovernanceService {
  constructor(private readonly repo: ApiRepository) {}

  get(organizationId: string): GovernancePolicy {
    if (!this.repo.getOrganization(organizationId)) {
      throw new Error('Organization not found');
    }
    return this.repo.getGovernancePolicy(organizationId);
  }

  updateRiskDefaults(
    organizationId: string,
    next: Partial<RiskDefaults>,
  ): GovernancePolicy {
    if (!this.repo.getOrganization(organizationId)) {
      throw new Error('Organization not found');
    }
    const current = this.repo.getGovernancePolicy(organizationId);
    const updated = setRiskDefaults(current, next);
    return this.repo.saveGovernancePolicy(organizationId, updated);
  }
}
