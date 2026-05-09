import { z } from 'zod';
import { spawn } from 'node:child_process';
import type { OrchestratorTool } from './types.js';

export const ShellSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
});

export const shellTool: OrchestratorTool<typeof ShellSchema> = {
  id: 'shell',
  schema: ShellSchema,
  toInvocation: (args) => ({
    action: 'execute',
    resourceType: 'shell',
    resourcePath: args.cwd,
    input: { command: args.command, cwd: args.cwd },
  }),
  execute: async ({ invocation, team }) => {
    const command = invocation.input?.command as string | undefined;
    const args = Array.isArray(invocation.input?.args)
      ? invocation.input.args.map((arg) => String(arg))
      : [];
    const cwd = typeof invocation.input?.cwd === 'string'
      ? invocation.input.cwd
      : team.workspace.root;

    if (typeof command !== 'string') {
      throw new Error("Input 'command' must be a string");
    }

    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      // Windows: run via cmd.exe so builtins (`dir`, etc.) and typical user commands work.
      // Unix: avoid `shell: true` so tests and callers can invoke explicit POSIX binaries
      // (`sh`, `cat`) without cmd.exe mangling; Git-Bash `sh.exe` remains on PATH when installed.
      const win32 = process.platform === 'win32';
      const child = spawn(command, args, {
        cwd,
        shell: win32,
        windowsHide: win32,
        env: process.env,
      });

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

      const maxBytes = 5 * 1024 * 1024;
      const handleData = (isStdout: boolean) => (chunk: Buffer) => {
        if (isStdout) stdout += chunk.toString();
        else stderr += chunk.toString();
        if (stdout.length + stderr.length > maxBytes) {
          child.kill('SIGTERM');
          finish(new Error('Command exceeded maximum output size (5MB)'));
        }
      };

      child.stdout?.on('data', handleData(true));
      child.stderr?.on('data', handleData(false));
      child.on('error', (error) => finish(error));
      child.on('close', (code) => finish(undefined, code ?? 0));
    });
  },
};
