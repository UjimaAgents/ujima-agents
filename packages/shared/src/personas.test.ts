import { describe, expect, it } from 'vitest';
import {
  PERSONA_TEMPLATES,
  assembleAgentFromTemplate,
  findPersonaTemplate,
  listPersonaTemplates,
} from './personas';
import { AgentDef } from './types';

describe('persona templates', () => {
  it('ships the 9 curated personas (Day-2 set plus QA pair, tech writer, security reviewer)', () => {
    const ids = listPersonaTemplates().map((t) => t.id);
    expect(ids).toEqual([
      'senior-designer',
      'junior-designer',
      'db-analyst',
      'senior-engineer',
      'junior-engineer',
      'senior-qa',
      'junior-qa',
      'tech-writer',
      'security-reviewer',
    ]);
  });

  it('senior-qa reviews junior-qa; junior-qa escalates to senior-qa', () => {
    const sr = findPersonaTemplate('senior-qa');
    const jr = findPersonaTemplate('junior-qa');
    expect(sr?.seniority).toBe('senior');
    expect(sr?.reviews).toEqual(['junior-qa']);
    expect(jr?.seniority).toBe('junior');
    expect(jr?.defaultEscalation.escalate_to).toBe('senior-qa');
  });

  it('tech-writer and security-reviewer are independent seniors with no juniors', () => {
    const writer = findPersonaTemplate('tech-writer');
    const sec = findPersonaTemplate('security-reviewer');
    expect(writer?.seniority).toBe('senior');
    expect(writer?.reviews).toBeUndefined();
    expect(sec?.seniority).toBe('senior');
    expect(sec?.reviews).toBeUndefined();
  });

  it('senior templates declare reviews; juniors declare escalation to senior', () => {
    const seniorDesigner = findPersonaTemplate('senior-designer');
    expect(seniorDesigner?.seniority).toBe('senior');
    expect(seniorDesigner?.reviews).toEqual(['junior-designer']);

    const juniorDesigner = findPersonaTemplate('junior-designer');
    expect(juniorDesigner?.seniority).toBe('junior');
    expect(juniorDesigner?.defaultEscalation.escalate_to).toBe('senior-designer');

    const juniorEngineer = findPersonaTemplate('junior-engineer');
    expect(juniorEngineer?.defaultEscalation.escalate_to).toBe('senior-engineer');
  });

  it('persona blocks are non-empty and reference the role', () => {
    for (const t of PERSONA_TEMPLATES) {
      expect(t.persona.length).toBeGreaterThan(50);
      expect(t.persona.toLowerCase()).toContain(t.name.toLowerCase());
    }
  });

  it('assembleAgentFromTemplate produces a valid AgentDef', () => {
    const agent = assembleAgentFromTemplate({
      agentId: 'agent_designer_jr_1',
      templateId: 'junior-designer',
      mcpId: 'figma-ai-bridge',
      model: 'vscode-lm/gpt-4o',
      permissions: {
        allowed_tools: ['get_file', 'create_frame'],
        blocked_tools: ['delete_node'],
        rate_limit: { max_session_tokens: 100_000 },
      },
      reportsTo: 'agent_designer_sr_1',
    });

    const parsed = AgentDef.parse(agent);
    expect(parsed.id).toBe('agent_designer_jr_1');
    expect(parsed.seniority).toBe('junior');
    expect(parsed.reports_to).toBe('agent_designer_sr_1');
    expect(parsed.communication.publishes).toContain('design:frames');
    expect(parsed.escalation.escalate_to).toBe('senior-designer');
  });

  it('throws on unknown template id', () => {
    expect(() =>
      assembleAgentFromTemplate({
        agentId: 'x',
        templateId: 'nope',
        mcpId: 'filesystem',
        model: 'm',
        permissions: { allowed_tools: [], blocked_tools: [], rate_limit: { max_session_tokens: 1 } },
      }),
    ).toThrow(/Unknown persona template/);
  });
});
