import { mkdir, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const stage = resolve('temp', 'build', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(stage, { recursive: true });
const environment = { ...process.env, WEBCAST_BUILD_DIR: stage };
function run(file, args = []) {
  const result = spawnSync(process.execPath, [file, ...args], { env: environment, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('node_modules/typescript/bin/tsc', ['--noEmit']);
run('scripts/prepare.mjs');
run('node_modules/vite/bin/vite.js', ['build']);
run('node_modules/vite/bin/vite.js', ['build', '--config', 'vite.content.config.ts']);
// Build in a fresh staging folder: no deletion, no obsolete bundles in the ZIP.
await cp(stage, 'dist', { recursive: true, force: true });
run('scripts/package.mjs', [stage]);
