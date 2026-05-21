import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentHomePath,
  agentId as configuredAgentId,
  configPath,
  defaultProfile,
  discoverConfiguredRoots,
  hasConfig,
  installedWorkspaceRoot,
  isAgentHome,
  pamemAgentsDir,
  resolveRuntimeRoot,
  runtimeMode,
  slockAgentsDir,
  supportedRoles,
} from './config.mjs';
import { installPamem, removePamem, repairPamem } from './install.mjs';
import { onboardPamem } from './onboard.mjs';
import { fail, runBash, runAndExit } from './process.mjs';
import { CheckCommandError, runCheckCommand } from './check.mjs';
import { updatePamem } from './update.mjs';
import {
  contextText,
  ensureCliState,
  envLines,
  hookJson,
  launchEnv,
  printStatus,
  recordSession,
  resolveRuntimeState,
  resumeArgs,
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
      runLaunch(args);
      break;
    case 'list':
      runList(args);
      break;
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
    case 'repair':
      if (printInstallHelp('repair', args)) break;
      repairPamem(args, context);
      break;
    case 'update':
      updatePamem(args, context);
      break;
    case 'remove':
      if (printSimpleForwardedHelp('remove', args, removeUsage)) break;
      removePamem(args, context);
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
      launchUsage();
      return;
    case 'list':
      listUsage();
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
    case 'repair':
      repairUsage();
      return;
    case 'update':
      updatePamem(['--help'], context);
      return;
    case 'remove':
      removeUsage();
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
  launch                 Initialize/bind a role, then start or resume a runtime.
  list                   List configured CLI agent homes.
  status                 Print resolved agent home, memory repo, and runtime state.
  hook-json              Print SessionStart hook input JSON for the agent.
  context                Print startup memory context for runtimes without hooks.
  lint                   Run read-only memory lint for the configured memory repo.
  check                  Validate pamem-owned handoff artifacts and owner gates.
  pr-check               Check memory PR changed-file scope and lint status.
  install [workspace]    Install/repair default pamem bootstrap files.
  onboard [workspace]    Create config, then install bootstrap files.
  repair [workspace]     Repair pamem bootstrap files.
  update                 Update the local pamem package or checkout.
  remove [workspace]     Remove managed hook entries.

Examples:
  pamem list
  pamem launch --role coder --agent-id coder-local -- codex
  pamem launch --role coder --agent-id coder-local --resume
  pamem launch --runtime slock --role coder --workspace <slock-agent-workspace>
  pamem status --agent-id coder-local --json
  pamem context --agent-id coder-local
  pamem lint --agent-id coder-local --json
  pamem check <proposal.json> --agent-id coder-local --json
  pamem pr-check --agent-id coder-local --head HEAD --target roles/coder/
  pamem update --self --dry-run

Use "pamem <command> --help" for command-specific options.`);
}

function listUsage() {
  console.log(`Usage: pamem list [--json]

List configured CLI agent homes and local Slock agent workspaces. Use
"pamem status --agent-id <id> --json" for stable machine-readable paths, or
"pamem status --agent-id <id>" to inspect one agent in detail.`);
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

function removeUsage() {
  console.log(`Usage: pamem remove [workspace]

Remove managed Codex hook and skill entries from a workspace. This leaves pamem
config, memory files, and shared memory repo contents in place.`);
}

function launchUsage() {
  console.log(`Usage: pamem launch --role <role> [--runtime cli|slock] [--agent-id <id>] [--workspace <path>] [--memory-repo <path>] [--sync-remote <target>] [--sync-ref <ref>] [--git-author-name <name>] [--git-author-email <email>] [--resume] [--print-env] [-- <command> [args...]]

CLI runtime:
  pamem launch --role coder --agent-id coder-local -- codex
  pamem launch --role coder --agent-id coder-local --resume

Slock runtime:
  pamem launch --runtime slock --role coder --workspace <slock-agent-workspace>

Role selection is the public startup contract. The config still stores the
selected role in the internal default_profile field. Memory repo, git remote,
and git author options are used only when launch creates a new pamem config; existing
configs are repaired without rewriting those fields.`);
}

function requireSupportedRole(role) {
  if (!supportedRoles.includes(role)) {
    fail(`unsupported role: ${role} (supported: ${supportedRoles.join('|')})`);
  }
}

function requireRoleMatch(root, requestedRole) {
  const existingRole = defaultProfile(root);
  if (existingRole !== requestedRole) {
    fail(`pamem config at ${root} is already bound to role=${existingRole}; choose a different --agent-id/--workspace or re-onboard deliberately`);
  }
}

function requireRuntimeMatch(root, requestedRuntime) {
  const existingRuntime = runtimeMode(root);
  if (existingRuntime !== requestedRuntime) {
    fail(`pamem config at ${root} is runtime=${existingRuntime}, not ${requestedRuntime}`);
  }
}

function parseLaunchArgs(args) {
  const parsed = {
    role: '',
    runtime: 'cli',
    agentId: '',
    workspace: '',
    resume: false,
    printEnv: false,
    onboardArgs: [],
    launchArgs: [],
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      parsed.launchArgs = args.slice(i + 1);
      break;
    }
    if (arg === '--role') {
      if (i + 1 >= args.length) fail('missing value for --role');
      parsed.role = args[++i];
      continue;
    }
    if (arg.startsWith('--role=')) {
      parsed.role = arg.slice('--role='.length);
      continue;
    }
    if (arg === '--runtime') {
      if (i + 1 >= args.length) fail('missing value for --runtime');
      parsed.runtime = args[++i];
      continue;
    }
    if (arg.startsWith('--runtime=')) {
      parsed.runtime = arg.slice('--runtime='.length);
      continue;
    }
    if (arg === '--agent-id') {
      if (i + 1 >= args.length) fail('missing value for --agent-id');
      parsed.agentId = args[++i];
      continue;
    }
    if (arg.startsWith('--agent-id=')) {
      parsed.agentId = arg.slice('--agent-id='.length);
      continue;
    }
    if (arg === '--workspace') {
      if (i + 1 >= args.length) fail('missing value for --workspace');
      parsed.workspace = args[++i];
      continue;
    }
    if (arg.startsWith('--workspace=')) {
      parsed.workspace = arg.slice('--workspace='.length);
      continue;
    }
    if (['--memory-repo', '--sync-remote', '--sync-ref', '--git-author-name', '--git-author-email'].includes(arg)) {
      if (i + 1 >= args.length) fail(`missing value for ${arg}`);
      parsed.onboardArgs.push(arg, args[++i]);
      continue;
    }
    if (/^--(memory-repo|sync-remote|sync-ref|git-author-name|git-author-email)=/.test(arg)) {
      const index = arg.indexOf('=');
      parsed.onboardArgs.push(arg.slice(0, index), arg.slice(index + 1));
      continue;
    }
    if (arg === '--resume') {
      parsed.resume = true;
      continue;
    }
    if (arg === '--print-env') {
      parsed.printEnv = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      launchUsage();
      process.exit(0);
    }
    fail(`unknown launch argument: ${arg}`);
  }

  return parsed;
}

function runLaunch(args) {
  const parsed = parseLaunchArgs(args);

  if (!parsed.role) fail('pamem launch requires --role');
  requireSupportedRole(parsed.role);
  if (parsed.runtime !== 'cli' && parsed.runtime !== 'slock') {
    fail(`unsupported runtime: ${parsed.runtime}`);
  }

  if (parsed.runtime === 'cli') {
    if (!parsed.workspace) {
      if (!parsed.agentId) {
        fail('pamem launch --runtime cli requires --agent-id when --workspace is not provided');
      }
      parsed.workspace = agentHomePath(parsed.agentId);
    }

    if (hasConfig(parsed.workspace)) {
      requireRoleMatch(parsed.workspace, parsed.role);
      requireRuntimeMatch(parsed.workspace, 'cli');
    } else {
      const initArgs = [parsed.workspace, '--agent-home', '--profile', parsed.role, '--runtime', 'cli', ...parsed.onboardArgs];
      if (parsed.agentId) initArgs.push('--agent-id', parsed.agentId);
      onboardPamem(initArgs, context);
    }

    const cliArgs = ['--workspace', parsed.workspace];
    if (parsed.agentId) cliArgs.push('--agent-id', parsed.agentId);
    if (parsed.printEnv) cliArgs.push('--print-env');
    runRuntimeCommand(parsed.resume ? 'resume' : 'start', parsed.launchArgs.length > 0 ? [...cliArgs, '--', ...parsed.launchArgs] : cliArgs);
    return;
  }

  if (!parsed.workspace) fail('pamem launch --runtime slock requires --workspace');
  if (parsed.resume) fail('pamem launch --runtime slock binds/repairs an existing Slock workspace; resume is handled by Slock');
  if (parsed.printEnv) fail('pamem launch --runtime slock does not emit CLI launcher environment');
  if (parsed.launchArgs.length > 0) fail('pamem launch --runtime slock does not start a process; start the agent through Slock');

  if (hasConfig(parsed.workspace)) {
    requireRoleMatch(parsed.workspace, parsed.role);
    requireRuntimeMatch(parsed.workspace, 'slock');
    repairPamem([parsed.workspace], context);
  } else {
    const initArgs = [parsed.workspace, '--profile', parsed.role, '--runtime', 'slock', ...parsed.onboardArgs];
    if (parsed.agentId) initArgs.push('--agent-id', parsed.agentId);
    onboardPamem(initArgs, context);
  }

  runRuntimeCommand('status', ['--workspace', parsed.workspace]);
}

function runRuntimeCommand(command, args) {
  const state = resolveRuntimeState(args, context, { command });

  switch (command) {
    case 'start':
      ensureCliState(state, assetsDir);
      if (state.launchArgs.length > 0) {
        const session = recordSession(state, 'start', state.launchArgs);
        runAndExit(state.launchArgs[0], state.launchArgs.slice(1), { cwd: state.workspace, env: launchEnv(state, 'start', session) });
      }
      printStatus(state);
      if (state.printEnv) console.log(envLines(state, 'start').join('\n'));
      break;
    case 'resume':
      ensureCliState(state, assetsDir);
      if (state.launchArgs.length > 0) {
        const session = recordSession(state, 'resume', state.launchArgs);
        runAndExit(state.launchArgs[0], state.launchArgs.slice(1), { cwd: state.workspace, env: launchEnv(state, 'resume', session) });
      }
      if (state.printEnv) {
        printStatus(state);
        console.log(envLines(state, 'resume').join('\n'));
        break;
      }
      {
        const argsToResume = resumeArgs(state);
        if (argsToResume.length === 0) {
          console.error(`no resumable session found for agent_id=${state.agentId}`);
          console.error(`Run 'pamem launch --role <role> --agent-id ${state.agentId} -- <launcher>' first, configure [runtime.resume].command, or pass an explicit resume command after --.`);
          process.exit(1);
        }
        const session = recordSession(state, 'resume', argsToResume);
        runAndExit(argsToResume[0], argsToResume.slice(1), { cwd: state.workspace, env: launchEnv(state, 'resume', session) });
      }
      break;
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

function runList(args) {
  if (args.includes('-h') || args.includes('--help')) {
    listUsage();
    process.exit(0);
  }

  const json = args.includes('--json');
  const unknown = args.filter((arg) => arg !== '--json');
  if (unknown.length > 0) fail(`unknown list argument: ${unknown[0]}`);

  const agentsDir = pamemAgentsDir();
  const slockDir = slockAgentsDir();
  const agents = discoverConfiguredRoots().map((root) => ({
    agent_id: configuredAgentId(root),
    role: defaultProfile(root),
    runtime: runtimeMode(root),
    kind: isAgentHome(root) ? 'agent-home' : 'workspace',
    home: root,
    config: configPath(root),
  })).sort((left, right) => (
    left.kind.localeCompare(right.kind)
    || left.agent_id.localeCompare(right.agent_id)
    || left.home.localeCompare(right.home)
  ));

  if (json) {
    console.log(JSON.stringify({ agents_dir: agentsDir, slock_agents_dir: slockDir, agents }, null, 2));
    return;
  }

  if (agents.length === 0) {
    console.log(`No pamem agents found under ${agentsDir} or ${slockDir}`);
    return;
  }
  console.log('agent_id\truntime\trole\tkind\thome');
  for (const agent of agents) {
    console.log(`${agent.agent_id}\t${agent.runtime}\t${agent.role}\t${agent.kind}\t${agent.home}`);
  }
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
