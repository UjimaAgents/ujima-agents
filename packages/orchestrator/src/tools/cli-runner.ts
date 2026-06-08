import { execFile } from 'node:child_process';
import { isSensitiveWorkspacePath } from '@ujima/shared/workspace-file-filters';

// ── Types ─────────────────────────────────────────────────────────

export interface CliRunOptions {
  /** Binary path (absolute, already resolved) */
  bin: string;
  /** Arguments to pass to the binary (no shell interpolation) */
  args: readonly string[];
  /** Working directory for the process */
  cwd: string;
  /** Max time in ms before kill (default: 15s) */
  timeout?: number;
  /** Max stdout bytes allowed before truncation (default: 1MB) */
  maxStdoutBytes?: number;
  /**
   * If true, post-process each line of stdout and filter out any
   * result whose path matches `isSensitiveWorkspacePath`.
   * Only meaningful for tools that emit file paths per line (rg, fd).
   */
  filterSensitivePaths?: boolean;
  /** Optional map function to process each output line before filtering */
  mapLine?: (line: string) => string;
}

export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** True if output was truncated due to maxStdoutBytes */
  truncated: boolean;
  /** Raw signal that killed the process (if any) */
  signal?: string;
}

// ── Runner ────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_STDOUT_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * Run a vendored CLI binary with proper safeguards:
 * - No shell interpolation (execFile, not exec)
 * - Timeout enforcement
 * - Max stdout bytes cap
 * - Post-hoc sensitive path filtering
 */
export function runCli(options: CliRunOptions): Promise<CliRunResult> {
  const {
    bin,
    args,
    cwd,
    timeout = DEFAULT_TIMEOUT_MS,
    maxStdoutBytes = DEFAULT_MAX_STDOUT_BYTES,
    filterSensitivePaths = false,
    mapLine,
  } = options;

  return new Promise<CliRunResult>((resolve, reject) => {
    const child = execFile(
      bin,
      args as readonly string[],
      {
        cwd,
        maxBuffer: maxStdoutBytes,
        timeout,
        killSignal: 'SIGTERM',
      },
      (error, stdout, stderr) => {
        // Even if error.code is non-null, we may have partial output.
        // We only reject on launch failures (ENOENT, EACCES).
        // Non-zero exit codes are returned as data.
        if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(`Binary not found: ${bin}. ${error.message}`));
          return;
        }
        if (error && (error as NodeJS.ErrnoException).code === 'EACCES') {
          reject(new Error(`Binary not executable: ${bin}. ${error.message}`));
          return;
        }

        const result: CliRunResult = {
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: error?.code != null ? Number(error.code) : 0,
          truncated: (stdout?.length ?? 0) >= maxStdoutBytes,
          signal: error?.signal ?? undefined,
        };

        resolve(result);
      },
    );

    // Handle child process-level errors (e.g., could not spawn)
    child.on('error', (err) => {
      reject(err);
    });
  });
}

// ── Line processing helpers ──────────────────────────────────────

/**
 * Split stdout into lines, optionally map each line, filter out
 * sensitive paths, and return the remaining lines.
 *
 * Sensitive path filtering: if `root` is provided, each line is
 * checked against `isSensitiveWorkspacePath`. Lines whose path
 * resolves within a sensitive directory are dropped. The check is
 * applied after `mapLine` (if specified) so tools like `rg --json`
 * can transform each line before the path check.
 */
export function filterOutputLines(
  stdout: string,
  options: {
    mapLine?: (line: string) => string;
    filterSensitivePaths?: boolean;
    root?: string;
  } = {},
): string[] {
  const { filterSensitivePaths = false, root } = options;
  const { mapLine } = options;

  const lines = stdout.split(/\r?\n/);
  const result: string[] = [];

  for (let raw of lines) {
    if (raw === '') continue;

    if (mapLine) {
      raw = mapLine(raw);
    }

    if (filterSensitivePaths && root) {
      // Try to extract a path from the line — for `rg --json` the
      // structure is different; callers should pass `mapLine` to
      // extract the path first. For simple file-per-line output
      // (fd, rg with --path-separator), the line *is* the path.
      const candidatePath = raw.trim();
      if (candidatePath && isSensitiveWorkspacePath(candidatePath)) {
        continue;
      }
    }

    result.push(raw);
  }

  return result;
}
