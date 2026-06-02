import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentHomePath,
  installedWorkspaceRoot,
  resolveRuntimeRoot,
} from './config.mjs';
import { installPamem, repairPamem } from './install.mjs';
import { onboardPamem } from './onboard.mjs';
import { setupPamem, setupUsage } from './setup.mjs';
import { fail, runBash } from './process.mjs';
import { CheckCommandError, runCheckCommand } from './check.mjs';
import {
  contextText,
  ensureCliState,
  envLines,
  hookJson,
  printStatus,
  resolveRuntimeState,
} from './runtime.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);
const scriptsDir = join(repoRoot, 'scripts');
const assetsDir = join(repoRoot, 'assets');
const runtimeRoot = resolveRuntimeRoot(repoRoot);
const defaultWorkspace = installedWorkspaceRoot(repoRoot) || '.';
const context = { repoRoot, scriptsDir, assetsDir, runtimeRoot, defaultWorkspace };

export function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;

  if (!command || command === '-h' || command === '--help') {
    usage();
    process.exit(0);
  }

  switch (command) {
    case 'launch':
    case 'list':
    case 'remove':
    case 'update':
      retiredUserCommand(command);
      return;
    case 'status':
    case 'context':
    case 'hook-json':
      if (printRuntimeHelp(command, args)) break;
      runRuntimeCommand(command, args);
      break;
    case 'lint':
      if (printSimpleForwardedHelp('lint', args, lintUsage)) break;
      runBash(join(runtimeRoot, 'skills', 'memory-lint', 'scripts', 'memory-lint.sh'), rewriteRootArgs(args));
      break;
    case 'check':
      runOwnedCommand(() => runCheckCommand(args, context));
      break;
    case 'pr-check':
      if (printSimpleForwardedHelp('pr-check', args, prCheckUsage)) break;
      runBash(join(runtimeRoot, 'scripts', 'memory-pr-check.sh'), rewriteRootArgs(args));
      break;
    case 'install':
      if (printInstallHelp('install', args)) break;
      installPamem(args, context);
      break;
    case 'onboard':
      if (printSimpleForwardedHelp('onboard', args, onboardUsage)) break;
      onboardPamem(args, context);
      break;
    case 'setup':
      if (printSimpleForwardedHelp('setup', args, setupUsage)) break;
      setupPamem(args, context);
      break;
    case 'repair':
      if (printInstallHelp('repair', args)) break;
      repairPamem(args, context);
      break;
    case 'help':
      runHelp(args);
      break;
    default:
      console.error(`unknown pamem command: ${command}`);
      usage();
      process.exit(2);
  }
}

function runHelp(args) {
  if (args.length === 0) {
    usage();
    return;
  }
  if (args.length > 1) fail(`usage: pamem help [command]`);

  switch (args[0]) {
    case 'launch':
    case 'list':
    case 'remove':
    case 'update':
      retiredUserCommand(args[0]);
      return;
    case 'status':
      statusUsage();
      return;
    case 'hook-json':
      hookJsonUsage();
      return;
    case 'context':
      contextUsage();
      return;
    case 'lint':
      lintUsage();
      return;
    case 'check':
      runOwnedCommand(() => runCheckCommand(['--help'], context));
      return;
    case 'pr-check':
      prCheckUsage();
      return;
    case 'install':
      installUsage();
      return;
    case 'onboard':
      onboardUsage();
      return;
    case 'setup':
      setupUsage();
      return;
    case 'repair':
      repairUsage();
      return;
    default:
      fail(`unknown pamem command: ${args[0]}`);
  }
}

function hasHelpArg(args) {
  return args.includes('-h') || args.includes('--help');
}

function printRuntimeHelp(command, args) {
  if (!hasHelpArg(args)) return false;
  if (args.length > 1) fail(`usage: pamem ${command} --help`);
  switch (command) {
    case 'status':
      statusUsage();
      return true;
    case 'hook-json':
      hookJsonUsage();
      return true;
    case 'context':
      contextUsage();
      return true;
    default:
      return false;
  }
}

function printSimpleForwardedHelp(command, args, usagePrinter) {
  if (!hasHelpArg(args)) return false;
  if (args.length > 1) fail(`usage: pamem ${command} --help`);
  usagePrinter();
  return true;
}

function printInstallHelp(command, args) {
  if (!hasHelpArg(args)) return false;
  if (args.length > 1) fail(`usage: pamem ${command} --help`);
  if (command === 'repair') repairUsage();
  else installUsage();
  return true;
}

function runOwnedCommand(callback) {
  try {
    const status = callback();
    process.exit(status ?? 0);
  } catch (error) {
    if (error instanceof CheckCommandError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }
}

function usage() {
  console.log(`Usage: pamem <command> [options]

Commands:
  status                 Print resolved agent home, memory repo, and runtime state.
  hook-json              Print SessionStart hook input JSON for the agent.
  context                Print startup memory context for runtimes without hooks.
  lint                   Run read-only memory lint for the configured memory repo.
  check                  Validate pamem-owned handoff artifacts and owner gates.
  pr-check               Check memory PR changed-file scope and lint status.
  install [workspace]    Install/repair default pamem bootstrap files.
  onboard [workspace]    Create config, then install bootstrap files.
  setup [workspace]      Stable component bootstrap wrapper for external tools.
  repair [workspace]     Repair pamem bootstrap files.

Examples:
  noesis launch --profile coder --runtime codex --agent-id coder-local
  noesis list
  noesis remove --agent-id coder-local
  pamem status --agent-id coder-local --json
  pamem context --agent-id coder-local
  pamem lint --agent-id coder-local --json
  pamem check <proposal.json> --agent-id coder-local --json
  pamem pr-check --agent-id coder-local --head HEAD --target roles/coder/
  pamem setup <workspace> --profile coder --runtime slock --json
  noesis update

User-facing launch/list/remove/update moved to Noesis. Use "noesis launch",
"noesis list", "noesis remove", and "noesis update" for runtime/session UX
and component maintenance.
Use "pamem <command> --help" for command-specific options.`);
}

function statusUsage() {
  console.log(`Usage: pamem status [--workspace <path>|--agent-id <id>] [--json] [--print-env]

Print resolved runtime state for a configured workspace or agent home. The JSON
form is the stable read-only interface for tools that need pamem paths without
taking ownership of memory.`);
}

function hookJsonUsage() {
  console.log(`Usage: pamem hook-json [--workspace <path>|--agent-id <id>]

Print the SessionStart hook input JSON for the resolved workspace or agent
home. This is mainly for runtime integration and debugging.`);
}

function contextUsage() {
  console.log(`Usage: pamem context [--workspace <path>|--agent-id <id>]

Print startup memory context for runtimes without native hook delivery. In CLI
mode, this also ensures local task-state files exist.`);
}

function lintUsage() {
  console.log(`Usage: pamem lint [--workspace <path>|--agent-id <id>] [--json] [--strict]

Run read-only pamem memory lint for the configured memory repo. Lint reports
profile load/write targets, runtime mode, git author config, and memory entry
health without repairing or mutating files.`);
}

function prCheckUsage() {
  console.log(`Usage: pamem pr-check [--workspace <path>|--agent-id <id>] --head <ref> --target <path> [--target <path>...] [--allow-guarded] [--json]

Check a shared-memory PR for changed-file scope and lint status. This is
read-only and intended for memory owner review before merge.`);
}

function installUsage() {
  console.log(`Usage: pamem install [workspace] [--agent-home]

Install default pamem bootstrap files into a workspace or agent home. This
creates or refreshes managed hooks, skill links, runtime-local task files, and
the configured shared memory repo skeleton without changing an existing role
binding.`);
}

function onboardUsage() {
  console.log(`Usage: pamem onboard [workspace] --profile <role> [--runtime cli|slock] [--agent-id <id>] [--memory-repo <path>] [--sync-remote <target>] [--sync-ref <ref>] [--git-author-name <name>] [--git-author-email <email>] [--agent-home] [--force]

Create or replace pamem config deliberately, then install bootstrap files. Use
onboard for intentional role/runtime binding, not routine repair.`);
}

function repairUsage() {
  console.log(`Usage: pamem repair [workspace] [--agent-home]

Refresh managed pamem bootstrap files for an existing workspace or agent home.
Repair reuses existing config and does not update pamem itself.`);
}

function runRuntimeCommand(command, args) {
  const state = resolveRuntimeState(args, context, { command });

  switch (command) {
    case 'status':
      printStatus(state);
      if (state.printEnv) console.log(envLines(state, 'start').join('\n'));
      break;
    case 'hook-json':
      console.log(JSON.stringify(hookJson(state), null, 2));
      break;
    case 'context':
      if (state.runtimeMode === 'cli') ensureCliState(state, assetsDir);
      console.log(contextText(state, context));
      break;
    default:
      fail(`unknown runtime command: ${command}`);
  }
}

function retiredUserCommand(command) {
  console.error(`pamem ${command} has moved to noesis ${command}.`);
  if (command === 'update') {
    console.error('Use "noesis update" for Noesis-managed package and component maintenance.');
  } else {
    console.error(`Use "noesis ${command}" for user-facing runtime/session management.`);
  }
  process.exit(2);
}

function rewriteRootArgs(args) {
  const rewritten = [];
  let sawRoot = false;
  let agentId = '';

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--root') {
      if (i + 1 >= args.length) fail('missing value for --root');
      sawRoot = true;
      rewritten.push('--root', args[++i]);
      continue;
    }
    if (arg.startsWith('--root=')) {
      sawRoot = true;
      rewritten.push(arg);
      continue;
    }
    if (arg === '--workspace') {
      if (i + 1 >= args.length) fail('missing value for --workspace');
      sawRoot = true;
      rewritten.push('--root', args[++i]);
      continue;
    }
    if (arg.startsWith('--workspace=')) {
      sawRoot = true;
      rewritten.push('--root', arg.slice('--workspace='.length));
      continue;
    }
    if (arg === '--agent-id') {
      if (i + 1 >= args.length) fail('missing value for --agent-id');
      agentId = args[++i];
      continue;
    }
    if (arg.startsWith('--agent-id=')) {
      agentId = arg.slice('--agent-id='.length);
      continue;
    }
    rewritten.push(arg);
  }

  if (!sawRoot) {
    let workspace = installedWorkspaceRoot(repoRoot);
    if (!workspace && agentId) workspace = agentHomePath(agentId);
    if (workspace) rewritten.unshift('--root', workspace);
  }

  return rewritten;
}
