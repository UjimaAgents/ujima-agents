import type { ChildProcess } from 'node:child_process';

export interface SupervisedChild {
  child: ChildProcess;
  label: string;
}

export interface SuperviseOptions {
  /** When true, child exits are expected (user-initiated shutdown). */
  isGracefulShutdown?: () => boolean;
  /** Max time to wait for siblings to exit after the first one stops. */
  shutdownTimeoutMs?: number;
}

function waitForAllExited(
  processes: SupervisedChild[],
  timeoutMs: number,
): Promise<number> {
  return new Promise((resolve) => {
    const children = processes.map(({ child }) => child);

    const maxExitCode = () => {
      let max = 0;
      for (const child of children) {
        const code = child.exitCode ?? 0;
        if (code > max) max = code;
      }
      return max;
    };

    const onExit = () => tryFinish();

    const timer = setTimeout(() => {
      for (const child of children) {
        if (child.exitCode == null && !child.killed) child.kill('SIGKILL');
      }
      cleanup();
      const allExited = children.every((child) => child.exitCode != null);
      resolve(allExited ? maxExitCode() : Math.max(maxExitCode(), 1));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      for (const child of children) {
        child.off('exit', onExit);
      }
    }

    function tryFinish() {
      if (children.every((child) => child.exitCode != null)) {
        cleanup();
        resolve(maxExitCode());
      }
    }

    for (const child of children) {
      child.on('exit', onExit);
    }
    tryFinish();
  });
}

/**
 * Run API + web as a supervised pair. Resolves when both children have stopped.
 * An unexpected exit from either process is a failure, even with code 0.
 */
export function superviseChildren(
  processes: SupervisedChild[],
  options: SuperviseOptions = {},
): Promise<number> {
  const isGracefulShutdown = options.isGracefulShutdown ?? (() => false);
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5000;

  return new Promise((resolvePromise) => {
    let settled = false;

    const stopSiblings = (except?: ChildProcess) => {
      for (const { child } of processes) {
        if (child === except) continue;
        if (child.exitCode != null) continue;
        if (child.killed) continue;
        child.kill('SIGTERM');
      }
    };

    const settle = async (failureCode: number) => {
      if (settled) return;
      settled = true;
      const finalCode = await waitForAllExited(processes, shutdownTimeoutMs);
      const graceful = isGracefulShutdown();
      resolvePromise(graceful ? finalCode : Math.max(failureCode, finalCode));
    };

    for (const { child, label } of processes) {
      child.on('error', (err) => {
        if (settled) return;
        process.stderr.write(`ujima start: ${label} error: ${err.message}\n`);
        if (!isGracefulShutdown()) stopSiblings(child);
        void settle(1);
      });

      child.on('exit', (code, signal) => {
        if (settled) return;

        const exitCode = signal ? 128 : (code ?? 0);

        if (isGracefulShutdown()) {
          void settle(exitCode);
          return;
        }

        stopSiblings(child);
        if (exitCode === 0) {
          process.stderr.write(
            `ujima start: ${label} exited unexpectedly while the stack was still running\n`,
          );
        } else {
          process.stderr.write(`ujima start: ${label} exited with code ${exitCode}\n`);
        }
        void settle(exitCode === 0 ? 1 : exitCode);
      });
    }
  });
}
