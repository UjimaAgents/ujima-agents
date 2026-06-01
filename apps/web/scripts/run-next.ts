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

const port = process.env.WEB_PORT ?? '3452';
const portNum = Number(port);
if (!Number.isInteger(portNum) || portNum < 0 || portNum > 65535) {
  console.error(`Invalid WEB_PORT: ${port}`);
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
    `Port ${portNum} is already in use. Stop the other process or set WEB_PORT to a free port.`,
  );
  console.error(`  PowerShell: Get-NetTCPConnection -LocalPort ${portNum} | Select OwningProcess`);
  process.exit(1);
}

const nextArgs = ['bunx', 'next', mode, '--port', port];
if (process.env.WEB_USE_WEBPACK === '1') {
  nextArgs.push('--webpack');
}
nextArgs.push(...extra);

const proc = spawn('bun', nextArgs, {
  cwd: root,
  env: { ...process.env, WEB_PORT: port },
  stdio: ['inherit', 'inherit', 'inherit'],
});

process.exit(await new Promise<number | null>((resolve) => proc.on('exit', resolve)));
