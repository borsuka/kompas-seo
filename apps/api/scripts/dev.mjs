// Dev loop: incremental tsc in watch mode + node --watch on the compiled output.
// (Nest DI needs decorator metadata, which esbuild-based runners like tsx don't emit.)
import { spawn, spawnSync } from 'node:child_process';

const build = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], {
  stdio: 'inherit',
  shell: true,
});
if (build.status !== 0) process.exit(build.status ?? 1);

const children = [
  spawn('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: true,
  }),
  spawn('node', ['--enable-source-maps', '--watch-path=dist', 'dist/main.js'], {
    stdio: 'inherit',
    shell: true,
  }),
];

const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((c) => c.on('exit', (code) => code && process.exit(code)));
