import type { RolePreset } from '../../schemas.js';
import { gameAudioEngineer } from './game-audio-engineer.js';
import { gameDesigner } from './game-designer.js';
import { levelDesigner } from './level-designer.js';
import { narrativeDesigner } from './narrative-designer.js';
import { technicalArtist } from './technical-artist.js';

export { gameAudioEngineer } from './game-audio-engineer.js';
export { gameDesigner } from './game-designer.js';
export { levelDesigner } from './level-designer.js';
export { narrativeDesigner } from './narrative-designer.js';
export { technicalArtist } from './technical-artist.js';

export const GameDevelopment_ROLE_PRESETS = {
  gameAudioEngineer,
  gameDesigner,
  levelDesigner,
  narrativeDesigner,
  technicalArtist,
} satisfies Record<string, RolePreset>;
