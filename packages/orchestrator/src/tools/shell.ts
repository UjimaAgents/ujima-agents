import { z } from 'zod';
import { spawn } from 'node:child_process';
import type { OrchestratorTool } from './types.js';

export const ShellSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().min(1).optional(),
});

export const shellTool: OrchestratorTool<typeof ShellSchema> = {
  id: 'shell',
  schema: ShellSchema,
  toInvocation: (args) => ({
    action: 'execute',
    resourceType: 'shell',
    resourcePath: args.cwd,
    input: {
      command: args.command,
      ...(args.args ? { args: args.args } : {}),
      cwd: args.cwd,
    },
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
          ? spawn(command, args, { cwd, shell: false, env: process.env })
          : spawn(command, { cwd, shell: true, env: process.env });

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
