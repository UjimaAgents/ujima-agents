const port = process.argv[2];

if (!port) {
  throw new Error('Missing port');
}

const result = Bun.spawnSync(['lsof', '-ti', `tcp:${port}`], {
  stdout: 'pipe',
  stderr: 'pipe',
});

if (result.exitCode !== 0) {
  process.exit(0);
}

const pids = new TextDecoder()
  .decode(result.stdout)
  .trim()
  .split('\n')
  .map((pid) => Number(pid))
  .filter((pid) => Number.isInteger(pid) && pid > 0);

for (const pid of pids) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // port may already be free
  }
}
