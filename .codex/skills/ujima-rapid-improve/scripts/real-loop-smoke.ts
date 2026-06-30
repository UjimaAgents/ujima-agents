import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const api = process.env.UJIMA_API_URL ?? 'http://127.0.0.1:7511';
const tokenPath = process.env.UJIMA_TOKEN_PATH ?? join(homedir(), '.ujima', 'token');
const token = (await readFile(tokenPath, 'utf-8')).trim();
const organizationOverride = process.env.UJIMA_ORGANIZATION_ID?.trim();
let sessionToken = process.env.UJIMA_SESSION_TOKEN?.trim();
const startedAt = Date.now();

type Member = { id: string; kind?: string; retiredAt?: string | null; name?: string; roleName?: string };
type Bootstrap = {
  organization?: { id: string };
  auth?: { member?: Member; session?: { token?: string }; sessionToken?: string };
  members?: Member[];
  team?: { members?: Member[]; agents?: Member[] };
};
type Message = { threadId: string };

function headers(json = false) {
  return {
    authorization: `Bearer ${token}`,
    ...(sessionToken ? { 'x-ujima-session': sessionToken } : {}),
    accept: 'application/json',
    ...(json ? { 'content-type': 'application/json' } : {}),
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${api}${path}`, { ...init, headers: { ...headers(Boolean(init?.body)), ...init?.headers } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body as T;
}

function pickAgent(boot: Bootstrap): Member {
  const members = [...(boot.members ?? []), ...(boot.team?.members ?? []), ...(boot.team?.agents ?? [])];
  const agent = members.find((m) => m.kind === 'agent' && !m.retiredAt) ?? members.find((m) => !m.retiredAt && m.id !== boot.auth?.member?.id);
  if (!agent) throw new Error('No active agent found in bootstrap.');
  return agent;
}

function prompt(agent: Member) {
  return [
    `@${agent.name ?? agent.id} run a real Ujima loop benchmark now.`,
    'You must perform at least 15 separate model/tool actions and use at least 10 distinct available tools of your choosing.',
    'Prefer safe read-only or harmless inspect actions. Do not modify files unless a tool is explicitly safe and reversible.',
    'Use the canonical dotted tool names and vary across categories: channel.list, channel.read, memory.recall, procedure.list, self.procedure.list, skill.read, ls, glob, grep, view, web_search.',
    'After the context pass, open the main loop files with view: packages/agent-runtime/src/ai-sdk-loop.ts, packages/llm/src/codex-responses.ts, packages/llm/src/select.ts, and packages/orchestrator/src/debug/agent-loop-logger.ts.',
    'Do not finish on metadata alone. You are not done until you have actually read those files and compared them.',
    'Prefer a new tool name when another safe tool can answer the same question, and do not keep rereading the same file with the same tool.',
    'Do not stop early. If fewer than 10 tools are available, use every available tool and say which were unavailable.',
    'End with a compact table: tool, why used, time/latency if visible, and bottleneck guess.',
  ].join('\n');
}

async function filesSince() {
  const dir = join(process.cwd(), '.agent-loop');
  const names = await readdir(dir).catch(() => []);
  const out: string[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    if ((await stat(path)).mtimeMs >= startedAt - 1000) out.push(path);
  }
  return out.sort();
}

async function summarize(paths: string[]) {
  let turns = 0;
  let actions = 0;
  let tokens = 0;
  const tools = new Map<string, number>();
  for (const path of paths) {
    const raw = await readFile(path, 'utf-8');
    if (!raw.trim()) continue;
    const log = JSON.parse(raw);
    turns++;
    tokens += log.tokenUsage?.totalTokens ?? log.steps?.[0]?.tokenUsage?.totalTokens ?? 0;
    for (const step of log.steps ?? []) {
      actions += 1 + (step.toolCalls?.length ?? 0) + (step.toolResults?.length ?? 0);
      for (const call of step.toolCalls ?? []) {
        const name = call.toolName ?? 'unknown';
        tools.set(name, (tools.get(name) ?? 0) + 1);
      }
    }
  }
  return {
    files: paths.length,
    turns,
    actions,
    distinctTools: tools.size,
    tokens,
    tools: [...tools.entries()].sort((a, b) => b[1] - a[1]),
  };
}

const boot = await request<Bootstrap>('/api/bootstrap');
if (!boot.auth?.member && process.env.UJIMA_EMAIL && process.env.UJIMA_PASSWORD) {
  const login = await request<{ sessionToken: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      organizationId: organizationOverride ?? boot.organization?.id,
      email: process.env.UJIMA_EMAIL,
      password: process.env.UJIMA_PASSWORD,
    }),
  });
  sessionToken = login.sessionToken;
}
const authedBoot = await request<Bootstrap>('/api/bootstrap');
const organizationId = authedBoot.organization?.id;
if (!organizationId) throw new Error('Bootstrap has no organization id.');
const senderId = authedBoot.auth?.member?.id;
if (!senderId) {
  throw new Error('Need UJIMA_SESSION_TOKEN or UJIMA_EMAIL/UJIMA_PASSWORD. ~/.ujima/token is daemon auth, not the owner web session.');
}
const agent = pickAgent(authedBoot);

const message = await request<Message>('/api/messages', {
  method: 'POST',
  body: JSON.stringify({
    organizationId,
    recipientId: agent.id,
    senderId,
    content: prompt(agent),
    clientMessageId: `rapid-loop-${Date.now()}`,
  }),
});

let paths: string[] = [];
let lastFileKey = '';
let quietPolls = 0;
for (let i = 0; i < 90; i++) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  paths = await filesSince();
  const summary = await summarize(paths);
  if (summary.actions >= 15 && summary.distinctTools >= 10) break;
  const fileKey = paths.join('|');
  quietPolls = fileKey && fileKey === lastFileKey ? quietPolls + 1 : 0;
  lastFileKey = fileKey;
  if (summary.actions > 0 && quietPolls >= 4) break;
}

const summary = await summarize(paths);
console.log(JSON.stringify({ agent: agent.id, threadId: message.threadId, loop: summary }, null, 2));

if (summary.files === 0) throw new Error('No new .agent-loop files. Restart daemon with UJIMA_AGENT_LOOP_LOGS=1.');
if (summary.actions < 15) throw new Error(`Real smoke too small: ${summary.actions} actions < 15.`);
if (summary.distinctTools < 10) throw new Error(`Real smoke used ${summary.distinctTools} distinct tools < 10.`);
