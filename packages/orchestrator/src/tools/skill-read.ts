import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OrchestratorTool } from './types.js';

/**
 * `skill.read` — load a skill's full instructions into the model context.
 *
 * Agents see installed skills listed in `<available_skills>` in the system
 * prompt. When the agent decides a skill is relevant it calls `skill.read`
 * with the skill's `name` (its `commandName`) to retrieve the rendered
 * `<loaded_skill>` block containing the complete SKILL.md body.
 *
 * The tool is read-only and baseline-available (no approval required).
 */

const schema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      'The commandName of the skill to load, exactly as listed in <available_skills>.',
    ),
  arguments: z
    .string()
    .optional()
    .describe(
      'Optional free-text arguments forwarded into the <arguments> section of the loaded skill block.',
    ),
});

function renderLoadedSkill(
  skill: { commandName: string; description: string; skillPath: string },
  instructions: string,
  argumentsText = '',
): string {
  return [
    '<loaded_skill>',
    `  <name>${skill.commandName}</name>`,
    `  <description>${skill.description}</description>`,
    `  <location>${skill.skillPath}</location>`,
    `  <arguments>${argumentsText.trim()}</arguments>`,
    '  <instructions>',
    instructions.trim(),
    '  </instructions>',
    '</loaded_skill>',
  ].join('\n');
}

export const skillReadTool: OrchestratorTool<typeof schema> = {
  id: 'skill.read',
  schema,

  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'skill',
    input: { name: args.name, arguments: args.arguments ?? '' },
  }),

  async execute({ invocation, repo }) {
    const { name, arguments: argumentsText = '' } = invocation.input as {
      name: string;
      arguments?: string;
    };

    const skills = repo.listOrganizationSkillInstalls?.(invocation.organizationId) ?? [];
    const skill = skills.find((s) => s.commandName === name);

    if (!skill) {
      const available = skills.map((s) => s.commandName).join(', ');
      return {
        error: `Skill "${name}" not found.`,
        available_skills: available || 'none',
      };
    }

    const plugin = repo.getPluginInstall?.(invocation.organizationId, skill.pluginInstallId);
    if (!plugin) {
      return { error: `Plugin install record not found for skill "${name}". Re-install the plugin from Settings.` };
    }

    const markdown = await readFile(resolve(plugin.localPath, skill.skillPath), 'utf8').catch(
      () => null,
    );

    if (!markdown) {
      return {
        error: `Skill file not readable for "${name}" at path: ${skill.skillPath}. The plugin cache may need to be refreshed.`,
      };
    }

    return renderLoadedSkill(skill, markdown, argumentsText);
  },
};
