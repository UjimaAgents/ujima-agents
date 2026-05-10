import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentDef, TeamDef, type AuditRecord } from '@ujima/shared';
import {
  filterAuditRecords,
  auditToCsv,
  auditToJson,
  callsPerMinute,
  bucketSamples,
  summarizeSession,
  type RateSample,
} from '@ujima/shared';
import {
  CURATED_REGISTRY,
  findRegistryEntry,
  instantiateFromRegistry,
} from '@ujima/mcp-client';
import {
  PERSONA_TEMPLATES,
  assembleAgentFromTemplate,
  findPersonaTemplate,
} from '@ujima/shared';

// Until @vscode/test-electron wiring lands, the cheapest way to exercise our real
// cross-package surface is a Node-side smoke that proves:
//   1. The shipped demo scenario stays aligned with the persona/registry source of truth.
//   2. The governance reducers stay pure and composable end-to-end.
// When any of these break, the demo story breaks.

const DEMO_SCENARIO_PATH = join(__dirname, '..', 'apps', 'vscode-extension', 'src', 'demo-scenario.ts');
const DEMO_AGENT_IDS = readDemoAgentIds();

test('every demo agent definition validates against AgentDef', () => {
  expect(DEMO_AGENT_IDS.length).toBeGreaterThan(0);
  for (const id of DEMO_AGENT_IDS) {
    const template = findPersonaTemplate(id);
    expect(template, `missing persona template for ${id}`).toBeTruthy();
    const suggested = findRegistryEntry(template!.suggestedMcp);
    expect(suggested, `missing registry entry for ${template!.suggestedMcp}`).toBeTruthy();
    const parsed = AgentDef.safeParse(
      assembleAgentFromTemplate({
        agentId: id,
        templateId: id,
        mcpId: template!.suggestedMcp,
        model: 'vscode-lm',
        permissions: {
          allowed_tools: [],
          blocked_tools: suggested?.knownDestructiveTools ?? [],
          rate_limit: { calls_per_minute: 30, max_session_tokens: 100_000 },
        },
      }),
    );
    if (!parsed.success) {
      throw new Error(`${id} failed AgentDef validation: ${parsed.error.issues[0]?.message}`);
    }
  }
});

test('demo team validates against TeamDef and references only shipped agents', () => {
  const team = TeamDef.parse({
    team_id: 'demo-team',
    name: 'Demo Team',
    agents: DEMO_AGENT_IDS,
  });
  const agentIds = new Set(DEMO_AGENT_IDS);
  expect(team.agents.length).toBeGreaterThan(0);
  for (const ref of team.agents) {
    expect(agentIds.has(ref), `team ${team.team_id} references unknown agent: ${ref}`).toBe(true);
  }
});

test('governance reducers: filter + export + summarize compose cleanly', () => {
  const records: AuditRecord[] = [
    rec('e1', { allowed: true, event_type: 'tool_call', agent_id: 'a', tool_name: 'read' }),
    rec('e2', { allowed: false, event_type: 'permission_check', agent_id: 'b', tool_name: 'write', block_reason: 'blocked_tool' }),
    rec('e3', { allowed: true, event_type: 'tool_call', agent_id: 'a', tool_name: 'write' }),
  ];

  const onlyBlocked = filterAuditRecords(records, { allowed: false });
  expect(onlyBlocked.map((r) => r.event_id)).toEqual(['e2']);

  const json = JSON.parse(auditToJson(records)) as AuditRecord[];
  expect(json).toHaveLength(3);
  expect(json[0]?.event_id).toBe('e1');

  const csv = auditToCsv(records);
  expect(csv.split('\n')).toHaveLength(4); // header + 3 rows
  expect(csv).toMatch(/blocked_tool/);

  const summary = summarizeSession({
    session_id: 's1',
    startedAt: new Date().toISOString(),
    status: 'running',
    agent_ids: ['a', 'b'],
    task_ids: [],
    audit: records,
  });
  expect(summary.tool_calls).toBe(2);
  expect(summary.blocked_calls).toBe(1);
});

test('rate reducers: bucketing + callsPerMinute', () => {
  const now = Date.now();
  const samples: RateSample[] = [];
  for (let i = 0; i < 30; i++) {
    samples.push({ at: new Date(now - i * 1_000).toISOString(), calls: 1, tokens: 10 });
  }
  expect(callsPerMinute(samples, now)).toBe(30);
  const buckets = bucketSamples(samples, { bucketMs: 5_000, buckets: 12, now });
  expect(buckets).toHaveLength(12);
  expect(buckets.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
});

function rec(id: string, overrides: Partial<AuditRecord>): AuditRecord {
  return {
    event_id: id,
    event_type: 'tool_call',
    agent_id: 'a',
    task_id: 't',
    session_id: 's',
    allowed: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

test('every curated registry entry instantiates with required substitutions', () => {
  expect(CURATED_REGISTRY.length).toBeGreaterThan(0);
  const placeholder: Record<string, string> = {
    rootDir: '/tmp/scope',
    dbPath: '/tmp/x.db',
    connectionString: 'postgres://u:p@h/db',
  };
  for (const entry of CURATED_REGISTRY) {
    const argSubs: Record<string, string> = {};
    for (const r of entry.requires?.args ?? []) {
      argSubs[r.key] = placeholder[r.key] ?? `/tmp/${r.key}`;
    }
    const envOverrides: Record<string, string> = {};
    for (const k of entry.requires?.envVars ?? []) envOverrides[k] = 'test';

    const def = instantiateFromRegistry(entry.id, { argSubstitutions: argSubs, envOverrides });
    expect(def.id).toBe(entry.id);
    expect(def.args).not.toContain(expect.stringMatching(/\$\{/));
    for (const k of entry.requires?.envVars ?? []) {
      expect(def.env[k]).toBe('test');
    }
    for (const [k, v] of Object.entries(argSubs)) {
      expect(def.args.some((a) => a.includes(v))).toBe(true);
    }
  }
});

test('curated registry has no duplicate ids', () => {
  const ids = CURATED_REGISTRY.map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('every persona template assembles into a valid AgentDef', () => {
  expect(PERSONA_TEMPLATES.length).toBeGreaterThan(0);
  for (const tpl of PERSONA_TEMPLATES) {
    const suggested = findRegistryEntry(tpl.suggestedMcp);
    expect(suggested, `persona ${tpl.id} suggests unknown mcp: ${tpl.suggestedMcp}`).toBeTruthy();

    const agent = assembleAgentFromTemplate({
      agentId: `agent_${tpl.id}_1`,
      templateId: tpl.id,
      mcpId: tpl.suggestedMcp,
      model: 'vscode-lm',
      permissions: {
        allowed_tools: [],
        blocked_tools: suggested?.knownDestructiveTools ?? [],
        rate_limit: { calls_per_minute: 30, max_session_tokens: 100_000 },
      },
    });
    const parsed = AgentDef.safeParse(agent);
    if (!parsed.success) {
      throw new Error(`${tpl.id} → invalid AgentDef: ${parsed.error.issues[0]?.message}`);
    }
  }
});

test('senior persona `reviews` point at real junior template ids', () => {
  const ids = new Set(PERSONA_TEMPLATES.map((t) => t.id));
  for (const tpl of PERSONA_TEMPLATES) {
    for (const ref of tpl.reviews ?? []) {
      expect(ids.has(ref), `${tpl.id}.reviews references unknown template: ${ref}`).toBe(true);
      expect(findPersonaTemplate(ref)?.seniority).toBe('junior');
    }
  }
});

test('junior persona escalation targets are seniors of the same family (or human)', () => {
  for (const tpl of PERSONA_TEMPLATES) {
    if (tpl.seniority !== 'junior') continue;
    const target = tpl.defaultEscalation.escalate_to;
    if (target === 'human') continue;
    const senior = findPersonaTemplate(target);
    expect(senior, `${tpl.id} escalates to unknown template: ${target}`).toBeTruthy();
    expect(senior?.seniority).toBe('senior');
  }
});

test('demo-scenario DEMO_AGENT_FILES matches the shipped agent JSONs 1:1', () => {
  const src = readFileSync(DEMO_SCENARIO_PATH, 'utf8');
  const match = src.match(/const DEMO_AGENT_FILES\s*=\s*\[([^\]]+)\]/);
  expect(match, 'DEMO_AGENT_FILES array not found in demo-scenario.ts').toBeTruthy();
  const listed = Array.from((match?.[1] ?? '').matchAll(/'([^']+\.json)'/g)).map((m) => m[1]);
  expect([...listed].sort()).toEqual(DEMO_AGENT_IDS.map((id) => `${id}.json`).sort());
});

test('demo team lists every shipped demo agent id', () => {
  const team = TeamDef.parse({
    team_id: 'demo-team',
    name: 'Demo Team',
    agents: DEMO_AGENT_IDS,
  });
  expect([...team.agents].sort()).toEqual([...DEMO_AGENT_IDS].sort());
});

test('every demo agent references a curated registry MCP', () => {
  const mcpIds = new Set(CURATED_REGISTRY.map((e) => e.id));
  for (const id of DEMO_AGENT_IDS) {
    const template = findPersonaTemplate(id);
    expect(template, `missing persona template for ${id}`).toBeTruthy();
    expect(mcpIds.has(template!.suggestedMcp), `${id} → unknown mcp: ${template!.suggestedMcp}`).toBe(true);
  }
});

test('every demo agent blocked_tools subset matches MCP knownDestructiveTools (if the registry declares any)', () => {
  for (const id of DEMO_AGENT_IDS) {
    const template = findPersonaTemplate(id);
    expect(template, `missing persona template for ${id}`).toBeTruthy();
    const entry = findRegistryEntry(template!.suggestedMcp);
    if (!entry?.knownDestructiveTools || entry.knownDestructiveTools.length === 0) continue;
    const agent = assembleAgentFromTemplate({
      agentId: id,
      templateId: id,
      mcpId: template!.suggestedMcp,
      model: 'vscode-lm',
      permissions: {
        allowed_tools: [],
        blocked_tools: entry.knownDestructiveTools,
        rate_limit: { calls_per_minute: 30, max_session_tokens: 100_000 },
      },
    });
    const blocked = new Set(agent.permissions.blocked_tools);
    const hit = entry.knownDestructiveTools.some((t) => blocked.has(t));
    expect(hit, `${agent.id} does not block any of ${entry.id}'s destructive tools`).toBe(true);
  }
});

function readDemoAgentIds(): string[] {
  const src = readFileSync(DEMO_SCENARIO_PATH, 'utf8');
  const match = src.match(/const DEMO_AGENT_FILES\s*=\s*\[([^\]]+)\]/);
  if (!match) {
    throw new Error('DEMO_AGENT_FILES array not found in demo-scenario.ts');
  }
  return Array.from(match[1].matchAll(/'([^']+)\.json'/g)).map((m) => m[1]);
}
