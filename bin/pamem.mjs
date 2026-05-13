#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);
const shellBackend = join(repoRoot, 'scripts', 'pamem-backend.sh');

function usage() {
  console.log(`Usage: pamem <command> [options]

Commands:
  launch                 Initialize/bind a role, then start or resume a runtime.
  status                 Print resolved agent home, memory repo, and runtime state.
  hook-json              Print SessionStart hook input JSON for the agent.
  context                Print startup memory context for runtimes without hooks.
  lint                   Run read-only memory lint for the configured memory repo.
  pr-check               Check memory PR changed-file scope and lint status.
  install [workspace]    Install/repair default pamem bootstrap files.
  repair [workspace]     Repair pamem bootstrap files.
  remove [workspace]     Remove managed hook entries.

Use "pamem <command> --help" for command-specific options.`);
}

function runShell(command, args) {
  const result = spawnSync('bash', [shellBackend, command, ...args], { stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
  }
  process.exit(result.status ?? 1);
}

function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === '-h' || command === '--help') {
    usage();
    process.exit(0);
  }

  runShell(command, args);
}

main();
