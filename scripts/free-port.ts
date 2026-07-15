const port = process.argv[2];

if (!port) {
  throw new Error('Missing port');
}

function listPidsOnPort(targetPort: string): number[] {
  const result =
    process.platform === 'win32'
      ? Bun.spawnSync(
          [
            'powershell',
            '-NoProfile',
            '-Command',
            `Get-NetTCPConnection -LocalPort ${targetPort} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
          ],
          {
            stdout: 'pipe',
            stderr: 'pipe',
          },
        )
      : Bun.spawnSync(['lsof', '-ti', `tcp:${targetPort}`], {
          stdout: 'pipe',
          stderr: 'pipe',
        });

  if (result.exitCode !== 0) {
    return [];
  }

  return [...new Set(
    new TextDecoder()
      .decode(result.stdout)
      .trim()
      .split(/\r?\n/)
      .map((pid) => Number(pid))
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  )];
}

function killPid(pid: number): void {
  try {
    if (process.platform === 'win32') {
      Bun.spawnSync(['taskkill', '/PID', String(pid), '/T', '/F'], {
        stdout: 'ignore',
        stderr: 'ignore',
      });
      return;
    }
    process.kill(pid, 'SIGKILL');
  } catch {
    // port may already be free
  }
}

const pids = listPidsOnPort(port);

for (const pid of pids) {
  killPid(pid);
}
