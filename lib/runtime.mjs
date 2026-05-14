import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  agentHomePath,
  agentId,
  agentLocalDir,
  configPath,
  defaultProfile,
  expandPath,
  findConfiguredRootByAgentId,
  hasConfig,
  installedWorkspaceRoot,
  isAgentHome,
  memoryRepoEntryFile,
  memoryRepoRoot,
  runtimeMode,
  tomlArrayValues,
  workspaceCurrentTaskPath,
  workspaceWorkLogPath,
} from './config.mjs';

export function resolveRuntimeState(args, context, options = {}) {
  const parsed = parseRuntimeArgs(args, options.command || '');
  const workspace = resolveWorkspace(parsed, context);
  if (!hasConfig(workspace)) {
    console.error(`pamem config not found for root: ${workspace}`);
    console.error("Run 'pamem launch --role <role> --agent-id <id>' or pass --workspace for an existing pamem workspace.");
    process.exit(1);
  }

  const mode = runtimeMode(workspace);
  const resolvedAgentId = parsed.agentId || agentId(workspace);
  const state = {
    workspace,
    configFile: configPath(workspace),
    runtimeMode: mode,
    agentId: resolvedAgentId,
    memoryRepoRoot: memoryRepoRoot(workspace),
    memoryEntryFile: memoryRepoEntryFile(workspace),
    localDir: '',
    currentTaskPath: '',
    workLogPath: '',
    sessionPath: '',
    launchArgs: parsed.launchArgs,
    printEnv: parsed.printEnv,
    json: parsed.json,
  };

  if (mode === 'cli') {
    state.localDir = agentLocalDir(workspace, resolvedAgentId);
    state.currentTaskPath = join(state.localDir, 'current-task.md');
    state.workLogPath = join(state.localDir, 'work-log.md');
    state.sessionPath = join(state.localDir, 'session.json');
  } else if (mode === 'slock') {
    state.currentTaskPath = workspaceCurrentTaskPath(workspace);
    state.workLogPath = workspaceWorkLogPath(workspace);
  }

  return state;
}

export function printStatus(state) {
  const lastCommand = state.runtimeMode === 'cli' ? readSession(state.sessionPath).last_command : [];
  if (state.json) {
    console.log(JSON.stringify(statusObject(state, lastCommand), null, 2));
    return;
  }
  const lines = [
    `root=${state.workspace}`,
    `runtime=${state.runtimeMode}`,
    `agent_id=${state.agentId}`,
    `memory_repo=${state.memoryRepoRoot}`,
    `memory_entry=${join(state.memoryRepoRoot, state.memoryEntryFile)}`,
    `task_state=${state.runtimeMode}`,
    `current_task=${state.currentTaskPath}`,
    `work_log=${state.workLogPath}`,
  ];
  if (state.runtimeMode === 'cli') {
    lines.push(`local_dir=${state.localDir}`);
    lines.push(`session_file=${state.sessionPath}`);
    lines.push(`last_command=${Array.isArray(lastCommand) ? lastCommand.map(shellQuote).join(' ') : ''}`);
  }
  console.log(lines.join('\n'));
}

export function statusObject(state, lastCommand = []) {
  const result = {
    status: 'ok',
    kind: isAgentHome(state.workspace) ? 'agent-home' : 'workspace',
    root: state.workspace,
    runtime: state.runtimeMode,
    role: defaultProfile(state.workspace),
    agent_id: state.agentId,
    config: state.configFile,
    memory_repo: state.memoryRepoRoot,
    memory_entry: join(state.memoryRepoRoot, state.memoryEntryFile),
    task_state: state.runtimeMode === 'slock' ? 'slock' : state.runtimeMode,
    current_task: state.currentTaskPath,
    work_log: state.workLogPath,
    agent_home: agentLocalDir(state.workspace, state.agentId),
  };
  if (state.runtimeMode === 'cli') {
    result.local_dir = state.localDir;
    result.session_file = state.sessionPath;
    result.last_command = Array.isArray(lastCommand) ? lastCommand : [];
  }
  return result;
}

export function envLines(state, action = 'start') {
  if (state.runtimeMode !== 'cli') return [];
  return [
    ['PAMEM_WORKSPACE', state.workspace],
    ['PAMEM_AGENT_ID', state.agentId],
    ['PAMEM_AGENT_HOME', state.localDir],
    ['PAMEM_LOCAL_DIR', state.localDir],
    ['PAMEM_CURRENT_TASK', state.currentTaskPath],
    ['PAMEM_WORK_LOG', state.workLogPath],
    ['PAMEM_SESSION_FILE', state.sessionPath],
    ['PAMEM_RESUME', action === 'resume' ? '1' : '0'],
  ].map(([key, value]) => `export ${key}=${shellQuote(value)}`);
}

export function hookJson(state) {
  const pamem = {
    runtime: state.runtimeMode,
    agent_id: state.agentId,
    task_state: state.runtimeMode === 'slock' ? 'slock' : state.runtimeMode,
    current_task: state.currentTaskPath,
    work_log: state.workLogPath,
  };
  if (state.runtimeMode === 'cli') {
    pamem.local_dir = state.localDir;
    pamem.session_file = state.sessionPath;
  }
  return { cwd: state.workspace, pamem };
}

export function contextText(state, context) {
  const result = spawnSync('bash', [join(context.scriptsDir, 'memory-session-start.sh')], {
    input: `${JSON.stringify(hookJson(state))}\n`,
    encoding: 'utf8',
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  const parsed = JSON.parse(result.stdout);
  return parsed.hookSpecificOutput?.additionalContext || '';
}

export function ensureCliState(state, assetsDir) {
  if (state.runtimeMode !== 'cli') {
    console.error(`pamem cli state is only for runtime.mode=cli; current runtime is ${state.runtimeMode}`);
    process.exit(2);
  }
  mkdirSync(state.localDir, { recursive: true });
  copyIfMissing(join(assetsDir, 'notes', 'current-task.md.template'), state.currentTaskPath);
  copyIfMissing(join(assetsDir, 'notes', 'work-log.md.template'), state.workLogPath);
}

export function recordSession(state, action, args) {
  mkdirSync(dirname(state.sessionPath), { recursive: true });
  writeFileSync(state.sessionPath, `${JSON.stringify({
    version: 1,
    agent_id: state.agentId,
    root: state.workspace,
    local_dir: state.localDir,
    current_task: state.currentTaskPath,
    work_log: state.workLogPath,
    last_action: action,
    updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    last_command: args,
  }, null, 2)}\n`);
}

export function resumeArgs(state) {
  const configured = tomlArrayValues(state.configFile, 'runtime.resume', 'command');
  if (configured.length > 0) return configured;
  const last = readSession(state.sessionPath).last_command;
  return Array.isArray(last) && last.length > 0 ? last : [];
}

export function launchEnv(state, action) {
  return {
    ...process.env,
    PAMEM_WORKSPACE: state.workspace,
    PAMEM_AGENT_ID: state.agentId,
    PAMEM_AGENT_HOME: state.localDir,
    PAMEM_LOCAL_DIR: state.localDir,
    PAMEM_CURRENT_TASK: state.currentTaskPath,
    PAMEM_WORK_LOG: state.workLogPath,
    PAMEM_SESSION_FILE: state.sessionPath,
    PAMEM_RESUME: action === 'resume' ? '1' : '0',
  };
}

function parseRuntimeArgs(args, command) {
  const parsed = {
    workspace: '',
    agentId: '',
    printEnv: false,
    json: false,
    launchArgs: [],
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      parsed.launchArgs = args.slice(i + 1);
      break;
    }
    if (arg === '--workspace') {
      if (i + 1 >= args.length) failArg('missing value for --workspace');
      parsed.workspace = args[++i];
      continue;
    }
    if (arg.startsWith('--workspace=')) {
      parsed.workspace = arg.slice('--workspace='.length);
      continue;
    }
    if (arg === '--agent-id') {
      if (i + 1 >= args.length) failArg('missing value for --agent-id');
      parsed.agentId = args[++i];
      continue;
    }
    if (arg.startsWith('--agent-id=')) {
      parsed.agentId = arg.slice('--agent-id='.length);
      continue;
    }
    if (arg === '--print-env') {
      parsed.printEnv = true;
      continue;
    }
    if (arg === '--json') {
      if (command !== 'status') failArg('--json is only supported for pamem status');
      parsed.json = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      runtimeUsage(command);
      process.exit(0);
    }
    failArg(`unknown argument: ${arg}`);
  }

  if (parsed.json && parsed.printEnv) {
    failArg('--json cannot be combined with --print-env');
  }

  return parsed;
}

function resolveWorkspace(parsed, context) {
  if (parsed.workspace) return expandPath(process.cwd(), parsed.workspace);
  if (parsed.agentId) return findConfiguredRootByAgentId(parsed.agentId) || agentHomePath(parsed.agentId);

  const found = findWorkspaceRoot(process.cwd());
  if (hasConfig(found)) return found;

  const installed = installedWorkspaceRoot(context.repoRoot);
  return installed || found;
}

function findWorkspaceRoot(start) {
  let dir = expandPath(process.cwd(), start);
  if (existsSync(dir) && !readableDirectory(dir)) dir = dirname(dir);
  while (dir !== '/') {
    if (hasConfig(dir)) return dir;
    dir = dirname(dir);
  }
  return expandPath(process.cwd(), start);
}

function readableDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readSession(path) {
  if (!nonEmptyFile(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function copyIfMissing(src, dst) {
  if (nonEmptyFile(dst)) return;
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, readFileSync(src));
}

function nonEmptyFile(path) {
  try {
    return readFileSync(path, 'utf8').length > 0;
  } catch {
    return false;
  }
}

function shellQuote(value) {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function failArg(message) {
  console.error(message);
  process.exit(2);
}

function runtimeUsage(command) {
  if (command === 'status') {
    console.log('Usage: pamem status [--workspace <path>] [--agent-id <id>] [--json] [--print-env]');
    return;
  }
  console.log(`Usage: pamem ${command || '<status|hook-json|context>'} [--workspace <path>] [--agent-id <id>] [--print-env] [-- <command> [args...]]`);
}
