// Runs the Next.js CLI with a repo-local SWC native binding cache.
// next-intl depends on @swc/core, whose native loader refuses cache folders with
// unusual ACLs (seen on Windows under %LOCALAPPDATA%). An explicit env var wins.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

if (!process.env.SWC_NATIVE_BINDING_CACHE) {
  const dir = fileURLToPath(new URL('../../../node_modules/.cache/swc', import.meta.url));
  mkdirSync(dir, { recursive: true });
  process.env.SWC_NATIVE_BINDING_CACHE = dir;
}

// Run Next's own entry with this Node directly: no shell in between, so signals reach Next
// and nothing is left running when this process is stopped.
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
