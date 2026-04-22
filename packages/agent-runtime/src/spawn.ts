import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { RunnerConfig } from './runner';
import type { AgentRunResult } from './types';

export interface SpawnProcessOptions {
  config: RunnerConfig;
  runnerPath?: string;
  env?: NodeJS.ProcessEnv;
  nodeExecPath?: string;
  silent?: boolean;
}

export interface AgentProcessHandle {
  pid: number | undefined;
  child: ChildProcess;
  agentId: string;
  result: Promise<AgentRunResult>;
  kill(signal?: NodeJS.Signals): void;
}

export function spawnAgentProcess(options: SpawnProcessOptions): AgentProcessHandle {
  const runnerPath = options.runnerPath ?? defaultRunnerPath();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    UJIMA_RUNNER_CONFIG: JSON.stringify(options.config),
    UJIMA_RUNNER_AUTOSTART: '1',
  };

  const child = fork(runnerPath, [], {
    env,
    execPath: options.nodeExecPath,
    stdio: options.silent ? ['ignore', 'pipe', 'pipe', 'ipc'] : 'inherit',
  });

  const buffer: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer.push(chunk.toString('utf8'));
  });

  const result = new Promise<AgentRunResult>((resolve, reject) => {
    child.on('exit', (code, signal) => {
      if (code === null && signal) {
        reject(new Error(`agent process killed by ${signal}`));
        return;
      }
      const parsed = extractResult(buffer.join(''));
      if (parsed) {
        resolve(parsed);
      } else {
        reject(
          new Error(`agent process exited with code ${code ?? 'null'} and produced no result`),
        );
      }
    });
    child.on('error', reject);
  });

  return {
    pid: child.pid,
    child,
    agentId: options.config.agent.id,
    result,
    kill(signal = 'SIGTERM') {
      if (!child.killed) child.kill(signal);
    },
  };
}

function defaultRunnerPath(): string {
  return path.resolve(__dirname, 'runner.js');
}

function extractResult(stdout: string): AgentRunResult | undefined {
  const lines = stdout.split('\n').reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as { ujimaResult?: AgentRunResult };
      if (parsed.ujimaResult) return parsed.ujimaResult;
    } catch {
      continue;
    }
  }
  return undefined;
}
