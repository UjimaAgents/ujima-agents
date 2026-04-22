import type { RoleConfig } from './schemas.js';

export function getSkillInstructions(role: RoleConfig): string {
  if (!role.skills || role.skills.length === 0) {
    return '';
  }

  const skillNames = role.skills.join(', ');
  return `\n\n# Available Skills\nYou have access to the following skills: ${skillNames}.\nYou can read their instructions and implementations at runtime by viewing the files in the \`.ujima/skills/<skill-name>/SKILL.md\` directories using your file reading tools.`;
}
