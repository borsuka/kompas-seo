#!/usr/bin/env node
// One-command local development: start services, migrate, then run all apps.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  if (res.status !== 0) {
    console.error(`\n✖ "${cmd} ${args.join(' ')}" failed with exit code ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Created .env from .env.example');
}

console.log('▶ Starting Docker services (postgres, clickhouse, redis, mailpit)…');
run('docker', ['compose', 'up', '-d', '--wait']);

console.log('▶ Building shared packages and running migrations…');
run('pnpm', ['turbo', 'run', 'build', '--filter=@seo/db...']);
run('pnpm', ['db:migrate']);

console.log('▶ Starting web, api and worker…');
const child = spawn('pnpm', ['dev:apps'], { stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
