import type { RolePreset } from '../../schemas.js';
import { macosSpatialMetalEngineer } from './macos-spatial-metal-engineer.js';
import { terminalIntegrationSpecialist } from './terminal-integration-specialist.js';
import { visionosSpatialEngineer } from './visionos-spatial-engineer.js';
import { xrCockpitInteractionSpecialist } from './xr-cockpit-interaction-specialist.js';
import { xrImmersiveDeveloper } from './xr-immersive-developer.js';
import { xrInterfaceArchitect } from './xr-interface-architect.js';

export { macosSpatialMetalEngineer } from './macos-spatial-metal-engineer.js';
export { terminalIntegrationSpecialist } from './terminal-integration-specialist.js';
export { visionosSpatialEngineer } from './visionos-spatial-engineer.js';
export { xrCockpitInteractionSpecialist } from './xr-cockpit-interaction-specialist.js';
export { xrImmersiveDeveloper } from './xr-immersive-developer.js';
export { xrInterfaceArchitect } from './xr-interface-architect.js';

export const SpatialComputing_ROLE_PRESETS = {
  macosSpatialMetalEngineer,
  terminalIntegrationSpecialist,
  visionosSpatialEngineer,
  xrCockpitInteractionSpecialist,
  xrImmersiveDeveloper,
  xrInterfaceArchitect,
} satisfies Record<string, RolePreset>;
