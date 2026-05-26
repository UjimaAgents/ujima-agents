import type { ChildProcess } from 'node:child_process';

export type SupervisedChild = {
  child: ChildProcess;
  label: string;
};

/**
 * Run API + web as a supervised pair. Resolves on the first child exit or error,
 * stops siblings immediately, and returns that exit code (non-zero when a process failed).
 */
export function superviseChildren(processes: SupervisedChild[]): Promise<number> {
  return new Promise((resolvePromise) => {
    let settled = false;

    const stopSiblings = (except?: ChildProcess) => {
      for (const { child } of processes) {
        if (child === except) continue;
        if (child.exitCode !== null || child.killed) continue;
        child.kill('SIGTERM');
      }
    };

    const finish = (exitCode: number, label: string, reason: 'exit' | 'error') => {
      if (settled) return;
      settled = true;
      stopSiblings();
      if (exitCode !== 0) {
        const detail =
          reason === 'error'
            ? 'failed to start'
            : `exited with code ${exitCode}`;
        process.stderr.write(`ujima start: ${label} ${detail}\n`);
      }
      resolvePromise(exitCode);
    };

    for (const { child, label } of processes) {
      child.on('error', (err) => {
        process.stderr.write(`ujima start: ${label} error: ${err.message}\n`);
        stopSiblings(child);
        finish(1, label, 'error');
      });
      child.on('exit', (code, signal) => {
        if (settled) return;
        const exitCode = signal ? 128 : (code ?? 0);
        stopSiblings(child);
        finish(exitCode, label, 'exit');
      });
    }
  });
}
