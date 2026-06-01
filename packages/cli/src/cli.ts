#!/usr/bin/env node
import { main } from './main.js';

void main().catch((err: unknown) => {
  process.stderr.write(`ujima: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
