import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentHomePath,
  defaultProfile,
  hasConfig,
  installedWorkspaceRoot,
  resolveRuntimeRoot,
  runtimeMode,
  supportedRoles,
} from './config.mjs';
import { installPamem, removePamem, repairPamem } from './install.mjs';
import { onboardPamem } from './onboard.mjs';
import { fail, runBash, runAndExit } from './process.mjs';
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
    case 'status':
    case 'context':
    case 'hook-json':
      runRuntimeCommand(command, args);
      break;
    case 'lint':
      runBash(join(runtimeRoot, 'skills', 'memory-lint', 'scripts', 'memory-lint.sh'), rewriteRootArgs(args));
      break;
    case 'pr-check':
      runBash(join(runtimeRoot, 'scripts', 'memory-pr-check.sh'), rewriteRootArgs(args));
      break;
    case 'install':
      installPamem(args, context);
      break;
    case 'onboard':
      onboardPamem(args, context);
      break;
    case 'repair':
      repairPamem(args, context);
      break;
    case 'remove':
      removePamem(args, context);
      break;
    case 'help':
      usage();
      break;
    default:
      console.error(`unknown pamem command: ${command}`);
      usage();
      process.exit(2);
  }
}

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
  onboard [workspace]    Create config, then install bootstrap files.
  repair [workspace]     Repair pamem bootstrap files.
  remove [workspace]     Remove managed hook entries.

Examples:
  pamem launch --role coder --agent-id coder-local -- codex
  pamem launch --role coder --agent-id coder-local --resume
  pamem launch --runtime slock --role coder --workspace <slock-agent-workspace>
  pamem status --agent-id coder-local
  pamem context --agent-id coder-local
  pamem lint --agent-id coder-local --json
  pamem pr-check --agent-id coder-local --head HEAD --target roles/coder/

Use "pamem <command> --help" for command-specific options.`);
}

function launchUsage() {
  console.log(`Usage: pamem launch --role <role> [--runtime cli|slock] [--agent-id <id>] [--workspace <path>] [--memory-repo <path>] [--sync-remote <target>] [--sync-ref <ref>] [--sync-executor <name>] [--git-author-name <name>] [--git-author-email <email>] [--resume] [--print-env] [-- <command> [args...]]

CLI runtime:
  pamem launch --role coder --agent-id coder-local -- codex
  pamem launch --role coder --agent-id coder-local --resume

Slock runtime:
  pamem launch --runtime slock --role coder --workspace <slock-agent-workspace>

Role selection is the public startup contract. The config still stores the
selected role in the internal default_profile field. Memory repo, sync, and git
author options are used only when launch creates a new pamem config; existing
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
    if (['--memory-repo', '--sync-remote', '--sync-ref', '--sync-executor', '--git-author-name', '--git-author-email'].includes(arg)) {
      if (i + 1 >= args.length) fail(`missing value for ${arg}`);
      parsed.onboardArgs.push(arg, args[++i]);
      continue;
    }
    if (/^--(memory-repo|sync-remote|sync-ref|sync-executor|git-author-name|git-author-email)=/.test(arg)) {
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
        recordSession(state, 'start', state.launchArgs);
        runAndExit(state.launchArgs[0], state.launchArgs.slice(1), { cwd: state.workspace, env: launchEnv(state, 'start') });
      }
      printStatus(state);
      if (state.printEnv) console.log(envLines(state, 'start').join('\n'));
      break;
    case 'resume':
      ensureCliState(state, assetsDir);
      if (state.launchArgs.length > 0) {
        recordSession(state, 'resume', state.launchArgs);
        runAndExit(state.launchArgs[0], state.launchArgs.slice(1), { cwd: state.workspace, env: launchEnv(state, 'resume') });
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
        recordSession(state, 'resume', argsToResume);
        runAndExit(argsToResume[0], argsToResume.slice(1), { cwd: state.workspace, env: launchEnv(state, 'resume') });
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
