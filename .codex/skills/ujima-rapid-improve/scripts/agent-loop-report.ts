import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

type Log = {
  runId?: string;
  turnIndex?: number;
  tokenUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  timestamps?: { startedAt?: string; finishedAt?: string };
  steps?: {
    toolCalls?: { toolName?: string }[];
    toolResults?: { output?: unknown }[];
    tokenUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  }[];
};

const dir = join(process.cwd(), '.agent-loop');
const files = (await readdir(dir).catch(() => []))
  .filter((f) => f.endsWith('.json'))
  .sort();

if (!files.length) {
  console.error('No .agent-loop/*.json logs found.');
  process.exit(1);
}

let turns = 0;
let tokens = 0;
let inputTokens = 0;
let outputTokens = 0;
let tools = 0;
let wallMs = 0;
let skipped = 0;
const byTool = new Map<string, number>();

for (const file of files) {
  const raw = await readFile(join(dir, file), 'utf-8');
  if (!raw.trim()) {
    skipped++;
    continue;
  }
  let log: Log;
  try {
    log = JSON.parse(raw) as Log;
  } catch {
    skipped++;
    continue;
  }
  turns++;
  const usage = log.tokenUsage ?? log.steps?.[0]?.tokenUsage ?? {};
  tokens += usage.totalTokens ?? 0;
  inputTokens += usage.inputTokens ?? 0;
  outputTokens += usage.outputTokens ?? 0;
  const started = log.timestamps?.startedAt ? Date.parse(log.timestamps.startedAt) : 0;
  const finished = log.timestamps?.finishedAt ? Date.parse(log.timestamps.finishedAt) : 0;
  if (started && finished && finished >= started) wallMs += finished - started;
  for (const step of log.steps ?? []) {
    for (const call of step.toolCalls ?? []) {
      tools++;
      const name = call.toolName ?? 'unknown';
      byTool.set(name, (byTool.get(name) ?? 0) + 1);
    }
  }
}

const hotTools = [...byTool.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8)
  .map(([name, count]) => `${name}:${count}`)
  .join(', ');

console.log(JSON.stringify({
  files: files.length,
  skipped,
  turns,
  tokens,
  inputTokens,
  outputTokens,
  tools,
  wallMs,
  hotTools,
}, null, 2));
