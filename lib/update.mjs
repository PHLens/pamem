import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function updatePamem(args, context) {
  const parsed = parseUpdateArgs(args);
  const commands = updateCommands(context.repoRoot);

  if (parsed.dryRun) {
    console.log(commands.map((command) => command.join(' ')).join(' && '));
    return;
  }

  for (const command of commands) {
    const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', cwd: context.repoRoot });
    if (result.error) {
      console.error(result.error.message);
      process.exit(1);
    }
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

function parseUpdateArgs(args) {
  const parsed = { dryRun: false };

  for (const arg of args) {
    if (arg === '-h' || arg === '--help') {
      updateUsage();
      process.exit(0);
    }
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    failUsage(`unknown update argument: ${arg}`);
  }

  return parsed;
}

function updateUsage() {
  console.log(`Usage: pamem update [--dry-run]

Update the local pamem package or checkout.

If pamem is running from a git checkout, this command fetches origin/main,
switches to main, and performs a fast-forward-only pull. Otherwise it updates
the global npm installation from the pamem GitHub repository.

Use pamem repair <workspace> after update when a workspace's runtime hooks,
skill links, or bootstrap files need to be refreshed.`);
}

function updateCommands(repoRoot) {
  if (existsSync(join(repoRoot, '.git'))) {
    return [
      ['git', '-C', repoRoot, 'fetch', 'origin', 'main'],
      ['git', '-C', repoRoot, 'switch', 'main'],
      ['git', '-C', repoRoot, 'pull', '--ff-only', 'origin', 'main'],
    ];
  }
  return [['npm', 'install', '-g', 'git+ssh://git@github.com/PHLens/pamem.git']];
}

function failUsage(message) {
  console.error(message);
  process.exit(2);
}
