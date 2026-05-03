import { z } from 'zod';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { parseShellToolCallArgs, shellInvocationDisplayLine } from '@ujima/shared';
import type { OrchestratorTool } from './types.js';

export const ShellSchema = z.object({
  operation: z.enum(['execute', 'send_input', 'read_output', 'wait', 'terminate']).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  background: z.boolean().optional(),
  job_id: z.string().optional(),
  input: z.string().optional(),
});

interface ShellJob {
  id: string;
  process: ChildProcess;
  cwd: string;
  /** Single-line display for terminal chrome (same as chat trace). */
  commandDisplay: string;
  stdoutBuffer: string;
  stderrBuffer: string;
  status: 'running' | 'exited' | 'error';
  exitCode?: number;
  error?: string;
  /** Cleared on process exit; escalates SIGTERM → SIGKILL after {@link TERMINATION_GRACE_MS}. */
  terminationGraceTimer?: ReturnType<typeof setTimeout>;
}

export interface BackgroundJobSnapshot {
  id: string;
  status: 'running' | 'exited' | 'error';
  cwd: string;
  commandLine: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
  error?: string;
}

const backgroundJobs = new Map<string, ShellJob>();

/** After SIGTERM, send SIGKILL if the child has not exited (handles ignored SIGTERM). */
const TERMINATION_GRACE_MS = 10_000;
const WAIT_POLL_MS = 250;
const WAIT_TIMEOUT_MS = 30_000;

function scheduleTerminationEscalation(jobKey: string, job: ShellJob): void {
  if (job.terminationGraceTimer) clearTimeout(job.terminationGraceTimer);
  job.terminationGraceTimer = setTimeout(() => {
    job.terminationGraceTimer = undefined;
    if (job.status !== 'running') return;
    const current = backgroundJobs.get(jobKey);
    if (!current || current !== job) return;
    try {
      if (process.platform === 'win32') {
        job.process.kill('SIGKILL');
      } else if (job.process.pid !== undefined) {
        process.kill(-job.process.pid, 'SIGKILL');
      }
    } catch {
      /* process may already be reaped */
    }
  }, TERMINATION_GRACE_MS);
}

function requestBackgroundJobTermination(jobKey: string): boolean {
  const job = backgroundJobs.get(jobKey);
  if (!job || job.status !== 'running') return false;
  try {
    if (process.platform === 'win32') {
      job.process.kill('SIGTERM');
    } else if (job.process.pid !== undefined) {
      process.kill(-job.process.pid, 'SIGTERM');
    }
  } catch {
    return false;
  }
  scheduleTerminationEscalation(jobKey, job);
  return true;
}

export function listBackgroundJobs(runId: string) {
  const result = [];
  for (const [key, job] of backgroundJobs.entries()) {
    if (key.startsWith(`${runId}:`)) {
      result.push({
        id: job.id,
        status: job.status,
      });
    }
  }
  return result;
}

/** Non-destructive read of buffered stdout/stderr for live UI polling (does not clear buffers). */
export function peekBackgroundJob(runId: string, jobId: string): BackgroundJobSnapshot | null {
  const key = `${runId}:${jobId}`;
  const job = backgroundJobs.get(key);
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    cwd: job.cwd,
    commandLine: job.commandDisplay,
    stdout: job.stdoutBuffer,
    stderr: job.stderrBuffer,
    exitCode: job.exitCode,
    error: job.error,
  };
}

async function waitForBackgroundJob(runId: string, jobId: string): Promise<BackgroundJobSnapshot | null> {
  const currentSnapshot = () => peekBackgroundJob(runId, jobId);
  const shouldResolve = (snapshot: BackgroundJobSnapshot | null) => !!snapshot && snapshot.status !== 'running';

  const initial = currentSnapshot();
  if (shouldResolve(initial)) {
    return initial;
  }

  return await new Promise<BackgroundJobSnapshot | null>((resolve, reject) => {
    const timer = setInterval(() => {
      const snapshot = currentSnapshot();
      if (!snapshot) {
        clearInterval(timer);
        clearTimeout(timeout);
        resolve(null);
        return;
      }
      if (shouldResolve(snapshot)) {
        clearInterval(timer);
        clearTimeout(timeout);
        resolve(snapshot);
      }
    }, WAIT_POLL_MS);

    const timeout = setTimeout(() => {
      clearInterval(timer);
      reject(new Error(`Timed out waiting for background job after ${WAIT_TIMEOUT_MS}ms`));
    }, WAIT_TIMEOUT_MS);
  });
}

export function terminateBackgroundJob(runId: string, jobId: string): boolean {
  return requestBackgroundJobTermination(`${runId}:${jobId}`);
}

export const shellTool: OrchestratorTool<typeof ShellSchema> = {
  id: 'shell',
  schema: ShellSchema,
  toInvocation: (args) => {
    const op = 'operation' in args && args.operation ? args.operation : 'execute';
    
    if (op === 'execute') {
      return {
        action: 'execute',
        resourceType: 'shell',
        resourcePath: args.cwd,
        input: {
          operation: 'execute',
          command: args.command,
          ...(args.args ? { args: args.args } : {}),
          cwd: args.cwd,
          background: args.background,
        },
      };
    }

    return {
      action: 'execute',
      resourceType: 'shell',
      resourcePath: undefined,
      input: args,
    };
  },
  execute: async ({ invocation, team }) => {
    const op = invocation.input?.operation || 'execute';

    if (op === 'send_input' || op === 'read_output' || op === 'wait' || op === 'terminate') {
      const job_id = invocation.input?.job_id as string;
      const jobKey = `${invocation.runId}:${job_id}`;
      const job = backgroundJobs.get(jobKey);

      if (!job) {
        throw new Error(`Job ${job_id} not found or already terminated`);
      }

      if (op === 'send_input') {
        const inputStr = invocation.input?.input as string;
        if (!job.process.stdin) {
          throw new Error(`Job ${job_id} does not accept stdin`);
        }
        job.process.stdin.write(inputStr);
        return { status: 'input_sent' };
      }

      if (op === 'read_output') {
        const result = {
          status: job.status,
          stdout: job.stdoutBuffer,
          stderr: job.stderrBuffer,
          exitCode: job.exitCode,
          error: job.error,
        };
        // Clear buffers after reading so next read is fresh
        job.stdoutBuffer = '';
        job.stderrBuffer = '';
        return result;
      }

      if (op === 'wait') {
        const snapshot = await waitForBackgroundJob(invocation.runId, job_id);
        if (!snapshot) {
          throw new Error(`Job ${job_id} not found or already terminated`);
        }
        return snapshot;
      }

      if (op === 'terminate') {
        if (!requestBackgroundJobTermination(jobKey)) {
          throw new Error(`Job ${job_id} not found or already terminated`);
        }
        return { status: 'terminated' };
      }
    }

    // op === 'execute'
    const command = invocation.input?.command as string | undefined;
    const args = Array.isArray(invocation.input?.args)
      ? invocation.input.args.map((arg) => String(arg))
      : [];
    const cwd = typeof invocation.input?.cwd === 'string'
      ? invocation.input.cwd
      : team.workspace.root;
    const background = !!invocation.input?.background;

    if (typeof command !== 'string') {
      throw new Error("Input 'command' must be a string");
    }

    // Windows: run via cmd.exe so builtins (`dir`, etc.) and typical user commands work.
    // Unix: when `args` is empty, run the command string through the shell so quotes and
    // operators work (`printf "ok"`). When `args` is non-empty, use an explicit argv and
    // no shell so path/workspace hardening tests can target real binaries (`sh`, `cat`).
    const win32 = process.platform === 'win32';
    const child = win32
      ? spawn(command, args, {
          cwd,
          shell: true,
          windowsHide: true,
          env: process.env,
        })
      : args.length > 0
        ? spawn(command, args, { cwd, shell: false, env: process.env, ...(background ? { detached: true } : {}) })
        : spawn(command, { cwd, shell: true, env: process.env, ...(background ? { detached: true } : {}) });

    const maxBytes = 5 * 1024 * 1024; // 5MB max buffer

    if (background) {
      const job_id = randomUUID();
      const jobKey = `${invocation.runId}:${job_id}`;
      const parsedDisplay = parseShellToolCallArgs(
        invocation.input as Record<string, unknown> | undefined,
      );
      const commandDisplay = parsedDisplay
        ? shellInvocationDisplayLine(parsedDisplay)
        : args.length > 0
          ? `${command} ${args.join(' ')}`
          : command;

      const job: ShellJob = {
        id: job_id,
        process: child,
        cwd,
        commandDisplay,
        stdoutBuffer: '',
        stderrBuffer: '',
        status: 'running',
      };
      backgroundJobs.set(jobKey, job);

      const handleData = (isStdout: boolean) => (chunk: Buffer) => {
        const text = chunk.toString();
        if (isStdout) {
          job.stdoutBuffer = (job.stdoutBuffer + text).slice(-maxBytes);
        } else {
          job.stderrBuffer = (job.stderrBuffer + text).slice(-maxBytes);
        }
      };

      child.stdout?.on('data', handleData(true));
      child.stderr?.on('data', handleData(false));
      child.on('error', (error) => {
        job.status = 'error';
        job.error = error.message;
      });
      child.on('close', (code) => {
        if (job.terminationGraceTimer) {
          clearTimeout(job.terminationGraceTimer);
          job.terminationGraceTimer = undefined;
        }
        job.status = 'exited';
        job.exitCode = code ?? 0;
      });

      return { job_id, message: `Background job started. Use wait or read_output with job_id ${job_id} to view logs.` };
    }

    // Synchronous execution
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      function finish(error?: Error, code?: number): void {
        clearTimeout(timeout);
        if (error) return reject(error);
        if (code !== 0) {
          return reject(
            new Error(stderr.trim() || `Command "${command}" exited with code ${code}`),
          );
        }
        resolve({ stdout, stderr });
      }

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        finish(new Error('Command timed out after 30 seconds'));
      }, 30000);

      const handleDataSync = (isStdout: boolean) => (chunk: Buffer) => {
        if (isStdout) stdout += chunk.toString();
        else stderr += chunk.toString();
        if (stdout.length + stderr.length > maxBytes) {
          child.kill('SIGTERM');
          finish(new Error('Command exceeded maximum output size (5MB)'));
        }
      };

      child.stdout?.on('data', handleDataSync(true));
      child.stderr?.on('data', handleDataSync(false));
      child.on('error', (error) => finish(error));
      child.on('close', (code) => finish(undefined, code ?? 0));
    });
  },
};
