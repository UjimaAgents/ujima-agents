#!/usr/bin/env bun
import { spawn } from 'node:child_process';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'start') {
  console.error('Usage: bun scripts/run-next.ts <dev|start> [-- extra next args]');
  process.exit(1);
}

const port = process.env.LANDING_PORT ?? '3453';
const portNum = Number(port);
if (!Number.isInteger(portNum) || portNum < 0 || portNum > 65535) {
  console.error(`Invalid LANDING_PORT: ${port}`);
  process.exit(1);
}

const extra = process.argv.slice(3);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const portInUse = await new Promise<boolean>((resolve) => {
  const probe = net.createServer();
  probe.once('error', () => resolve(true));
  probe.once('listening', () => {
    probe.close(() => resolve(false));
  });
  probe.listen(portNum);
});

if (portInUse) {
  console.error(
    `Port ${portNum} is already in use. Stop the other process or set LANDING_PORT to a free port.`,
  );
  console.error(`  PowerShell: Get-NetTCPConnection -LocalPort ${portNum} | Select OwningProcess`);
  process.exit(1);
}

const nextArgs = ['x', 'next', mode, '--port', port];
nextArgs.push(...extra);

const proc = spawn(process.execPath, nextArgs, {
  cwd: root,
  env: { ...process.env, LANDING_PORT: port },
  stdio: ['inherit', 'inherit', 'inherit'],
});

const exitCode = await new Promise<number | null>((resolve) => proc.on('exit', resolve));
process.exit(exitCode ?? 0);
