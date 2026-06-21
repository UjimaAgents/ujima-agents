import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode', 'better-sqlite3', 'onnxruntime-node'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[esbuild] watching…');
} else {
  await build(options);
}
