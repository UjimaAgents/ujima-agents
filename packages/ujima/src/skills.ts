import type { RoleConfig } from './schemas.js';

export function getSkillInstructions(role: RoleConfig): string {
  if (!role.skills || role.skills.length === 0) {
    return '';
  }

  const skillNames = role.skills.join(', ');
  return `\n\n# Available Skills\nYou have access to the following skills: ${skillNames}.\nTo load the full instructions for any skill, call \`skill.read\` with its \`name\` (exactly as shown in <available_skills>).`;
}
