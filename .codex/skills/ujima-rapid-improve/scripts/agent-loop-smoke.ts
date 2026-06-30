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

const PROMPTS: Record<string, string> = {
  'multi-turn': [
    'Do a full diagnostic sweep of this workspace:',
    '- List all available channels and procedures',
    '- Recall from memory what you know about this project',
    '- List all files in packages/agent-runtime/src/',
    '- Read the three largest .ts files in that directory',
    '- Summarize what each does and how they connect',
    '- Finally, create a file called diagnostic-report.md with your findings',
    'Use every distinct tool category you can. Show your work at each step.',
  ].join('\n'),
  'approval': [
    'Run an approval diagnostic:',
    '- Create a file called approval-test-a.md with content "phase 1"',
    '- Then modify approval-test-a.md to say "phase 2"',
    '- Then create another file called approval-test-b.md with content "phase 3"',
    '- Then delete approval-test-a.md',
    'Pause for approval at each step and report what scope each approval request covers.',
  ].join('\n'),
  'error-recovery': [
    'Test error recovery:',
    '- Read a file called nonexistent-file-xyz.md',
    '- Then read package.json',
    '- Then read another nonexistent file called missing-data.json',
    '- Then list all .ts files in packages/orchestrator/src/',
    '- Then create recovery-results.md summarizing which operations failed and which succeeded',
    'Do not stop on errors. Continue through all steps.',
  ].join('\n'),
  'tool-routing': [
    'Exercise every tool category:',
    '- List all channels with channel.list',
    '- Read the latest message in each channel with channel.read',
    '- Recall past session memories with memory.recall',
    '- List available procedures with procedure.list',
    '- List your own procedures with self.procedure.list',
    '- Search for files containing "agent-loop" with grep',
    '- Read one of the matches with view',
    '- List the workspace directory with ls',
    '- Finally, create tool-routing-report.md documenting which tools worked',
  ].join('\n'),
  'rapid-calls': [
    'Read every .ts file in packages/agent-runtime/src/ one by one.',
    'List the filename and first export of each.',
    'Do not skip any file. Read them all in sequence.',
  ].join('\n'),
  'wake': 'Hello, please introduce yourself and describe what tools you have available.',
};

const AREAS = Object.keys(PROMPTS);
const chosenArea = AREAS[Math.floor(Math.random() * AREAS.length)];

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
const promptText = PROMPTS[chosenArea];

const message = await request<Message>('/api/messages', {
  method: 'POST',
  body: JSON.stringify({
    organizationId,
    recipientId: agent.id,
    senderId,
    content: promptText,
    clientMessageId: `harness-diagnostic-${chosenArea}-${Date.now()}`,
  }),
});

let paths: string[] = [];
let lastFileCount = 0;
let quietPolls = 0;
for (let i = 0; i < 120; i++) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  paths = await filesSince();
  const currentCount = paths.length;
  if (currentCount === lastFileCount && currentCount > 0) {
    quietPolls++;
  } else {
    quietPolls = 0;
  }
  lastFileCount = currentCount;
  if (quietPolls >= 6) break;
}

if (paths.length === 0) {
  console.error(JSON.stringify({
    status: 'no-loop-files',
    agent: agent.id,
    threadId: message.threadId,
    area: chosenArea,
    prompt: promptText,
    hint: 'Agent may not have woken. Check daemon logs and UJIMA_AGENT_LOOP_LOGS=1.',
  }));
  process.exit(1);
}

process.stdout.write(JSON.stringify({
  area: chosenArea,
  prompt: promptText,
  agent: agent.id,
  threadId: message.threadId,
  paths,
}) + '\n');
