import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

type TurnStep = {
  status?: string;
  toolCalls?: { toolName?: string; input?: unknown }[];
  toolResults?: { output?: unknown; toolName?: string; isError?: boolean }[];
  tokenUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  timestamp?: string;
};

type LoopFile = {
  runId?: string;
  turnIndex?: number;
  status?: string;
  timestamps?: { startedAt?: string; finishedAt?: string };
  tokenUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  steps?: TurnStep[];
};

type BugReport = {
  type: string;
  severity: 'error' | 'warning' | 'info';
  file: string;
  turnIndex?: number;
  stepIndex?: number;
  message: string;
  evidence?: unknown;
};

const reports: BugReport[] = [];
const inputFiles = process.argv.slice(2);

async function loadFiles(): Promise<string[]> {
  if (inputFiles.length > 0) {
    return inputFiles.filter((f) => f.endsWith('.json'));
  }
  const dir = join(process.cwd(), '.agent-loop');
  return (await readdir(dir).catch(() => []))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => join(dir, f));
}

function report(bug: BugReport) {
  reports.push(bug);
}

function checkStalledTurn(file: string, log: LoopFile) {
  if (!log.timestamps?.startedAt) return;
  if (log.timestamps.finishedAt) return;
  if (!log.steps || log.steps.length === 0) {
    report({
      type: 'stalled-turn',
      severity: 'error',
      file,
      turnIndex: log.turnIndex,
      message: 'Turn started but never finished and has no steps. The loop may have stalled or crashed.',
      evidence: { startedAt: log.timestamps.startedAt },
    });
  }
}

function checkEmptyTurn(file: string, log: LoopFile) {
  if (!log.steps || log.steps.length === 0) {
    if (log.timestamps?.finishedAt) {
      report({
        type: 'empty-turn',
        severity: 'warning',
        file,
        turnIndex: log.turnIndex,
        message: 'Turn completed with zero steps. The model may have produced no action.',
      });
    }
  }
}

function checkOrphanResults(file: string, log: LoopFile) {
  if (!log.steps) return;
  for (let i = 0; i < log.steps.length; i++) {
    const step = log.steps[i];
    const calls = step.toolCalls?.length ?? 0;
    const results = step.toolResults?.length ?? 0;
    if (results > 0 && calls === 0 && i === 0) {
      report({
        type: 'orphan-results',
        severity: 'error',
        file,
        turnIndex: log.turnIndex,
        stepIndex: i,
        message: 'Step has tool results but no tool calls in the same step. Results may belong to a previous turn or the bridge desynced.',
        evidence: { results: step.toolResults?.length },
      });
    }
  }
}

function checkToolResultError(file: string, log: LoopFile) {
  if (!log.steps) return;
  for (let i = 0; i < log.steps.length; i++) {
    const step = log.steps[i];
    for (const result of step.toolResults ?? []) {
      if (result.isError) {
        report({
          type: 'tool-error',
          severity: 'warning',
          file,
          turnIndex: log.turnIndex,
          stepIndex: i,
          message: `Tool "${result.toolName ?? 'unknown'}" returned an error. Check if the harness surfaced this to the model or swallowed it.`,
          evidence: result.output,
        });
      }
      const output = result.output;
      if (typeof output === 'string' && (output.includes('error') || output.includes('Error') || output.includes('ENOENT') || output.includes('ECONNREFUSED'))) {
        report({
          type: 'tool-error-string',
          severity: 'info',
          file,
          turnIndex: log.turnIndex,
          stepIndex: i,
          message: `Tool "${result.toolName ?? 'unknown'}" output contains an error string. May indicate a failure the model needs to handle.`,
        });
      }
    }
  }
}

function checkDuplicateToolCalls(file: string, log: LoopFile) {
  if (!log.steps) return;
  for (let i = 0; i < log.steps.length; i++) {
    const step = log.steps[i];
    const calls = step.toolCalls ?? [];
    for (let j = 0; j < calls.length; j++) {
      for (let k = j + 1; k < calls.length; k++) {
        if (calls[j].toolName && calls[j].toolName === calls[k].toolName) {
          report({
            type: 'duplicate-tool-call',
            severity: 'warning',
            file,
            turnIndex: log.turnIndex,
            stepIndex: i,
            message: `Tool "${calls[j].toolName}" called twice in the same step with${calls[j].input !== undefined ? '' : 'out'} input. May indicate redundant bridge dispatch.`,
            evidence: { call1: calls[j].toolName, call2: calls[k].toolName },
          });
        }
      }
    }
  }
}

function checkMissingRequiredFields(file: string, log: LoopFile) {
  if (!log.steps) return;
  for (let i = 0; i < log.steps.length; i++) {
    const step = log.steps[i];
    if (!step.tokenUsage && step.toolCalls?.length) {
      report({
        type: 'missing-token-usage',
        severity: 'warning',
        file,
        turnIndex: log.turnIndex,
        stepIndex: i,
        message: 'Step has tool calls but no tokenUsage. Token accounting may be incomplete.',
      });
    }
  }
}

function checkStatusField(file: string, log: LoopFile) {
  if (!log.steps) return;
  for (let i = 0; i < log.steps.length; i++) {
    const step = log.steps[i];
    if (step.status && step.status !== 'success' && step.status !== 'complete') {
      report({
        type: 'unexpected-step-status',
        severity: 'error',
        file,
        turnIndex: log.turnIndex,
        stepIndex: i,
        message: `Step has unexpected status "${step.status}". Expected "success" or "complete".`,
        evidence: { status: step.status },
      });
    }
  }
}

function checkImpossibleTimestamp(file: string, log: LoopFile) {
  const started = log.timestamps?.startedAt ? Date.parse(log.timestamps.startedAt) : 0;
  const finished = log.timestamps?.finishedAt ? Date.parse(log.timestamps.finishedAt) : 0;
  if (started && finished && finished < started) {
    report({
      type: 'impossible-timestamp',
      severity: 'error',
      file,
      turnIndex: log.turnIndex,
      message: 'finishedAt is before startedAt. Clock skew or logger bug.',
      evidence: { startedAt: log.timestamps.startedAt, finishedAt: log.timestamps.finishedAt },
    });
  }
}

function checkNegativeTokens(file: string, log: LoopFile) {
  const usage = log.tokenUsage;
  if (usage) {
    if ((usage.totalTokens != null && usage.totalTokens < 0) ||
        (usage.inputTokens != null && usage.inputTokens < 0) ||
        (usage.outputTokens != null && usage.outputTokens < 0)) {
      report({
        type: 'negative-tokens',
        severity: 'error',
        file,
        turnIndex: log.turnIndex,
        message: 'Token usage contains negative values. Harness accounting bug.',
        evidence: usage,
      });
    }
  }
}

function checkAbruptEnd(file: string, log: LoopFile) {
  if (!log.timestamps?.startedAt) return;
  if (log.timestamps.finishedAt) return;
  if (!log.steps || log.steps.length === 0) return;
  const lastStep = log.steps[log.steps.length - 1];
  if (lastStep.toolCalls?.length && !lastStep.toolResults?.length) {
    report({
      type: 'abrupt-end',
      severity: 'error',
      file,
      turnIndex: log.turnIndex,
      stepIndex: log.steps.length - 1,
      message: 'Turn ends with pending tool calls but no results and no finishedAt. The runtime may have crashed mid-step.',
      evidence: { pendingCalls: lastStep.toolCalls?.length },
    });
  }
}

function checkCorruptJson(file: string, raw: string) {
  if (!raw.trim()) {
    report({
      type: 'empty-file',
      severity: 'error',
      file,
      message: '.agent-loop file is empty. Logger may have crashed during write.',
    });
    return null;
  }
  try {
    return JSON.parse(raw) as LoopFile;
  } catch (err) {
    report({
      type: 'corrupt-json',
      severity: 'error',
      file,
      message: `Failed to parse JSON: ${(err as Error).message}. Logger may have produced truncated output.`,
    });
    return null;
  }
}

async function main() {
  const files = await loadFiles();
  if (!files.length) {
    console.error(JSON.stringify({ status: 'no-files', hint: 'No .agent-loop/*.json files found.' }));
    process.exit(1);
  }

  for (const file of files) {
    const raw = await readFile(file, 'utf-8');
    const log = checkCorruptJson(file, raw);
    if (!log) continue;

    checkStalledTurn(file, log);
    checkEmptyTurn(file, log);
    checkOrphanResults(file, log);
    checkToolResultError(file, log);
    checkDuplicateToolCalls(file, log);
    checkMissingRequiredFields(file, log);
    checkStatusField(file, log);
    checkImpossibleTimestamp(file, log);
    checkNegativeTokens(file, log);
    checkAbruptEnd(file, log);
  }

  if (inputFiles.length > 0) {
    const indices = files.map((f) => {
      const log = JSON.parse('{}');
      const m = f.match(/turn-(\d+)/);
      return m ? parseInt(m[1]) : -1;
    }).filter((i) => i >= 0);
    if (indices.length > 1) {
      for (let i = 1; i < indices.length; i++) {
        if (indices[i] - indices[i - 1] > 1) {
          report({
            type: 'turn-gap',
            severity: 'warning',
            file: inputFiles[0],
            turnIndex: indices[i - 1],
            message: `Gap in turn indices: ${indices[i - 1]} → ${indices[i]}. A turn may have been skipped or lost.`,
          });
        }
      }
    }
  }

  const bySeverity = { error: 0, warning: 0, info: 0 };
  for (const r of reports) bySeverity[r.severity]++;

  process.stdout.write(JSON.stringify({
    files: files.length,
    bugsFound: reports.length,
    bySeverity,
    reports,
  }, null, 2));
}

await main();
