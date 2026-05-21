import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { memoryRepoRoot, supportedRoles, tomlValue } from './config.mjs';
import { onboardPamem } from './onboard.mjs';
import { fail } from './process.mjs';

const supportedRuntimes = ['cli', 'slock'];

export function setupPamem(args, context) {
  const parsed = parseSetupArgs(args);
  const onboardArgs = [
    parsed.workspace,
    '--profile',
    parsed.profile,
    '--runtime',
    parsed.runtime,
    ...parsed.forwarded,
  ];
  if (parsed.force) onboardArgs.push('--force');
  if (parsed.agentHomeMode) onboardArgs.push('--agent-home');

  if (parsed.json) {
    const output = captureStdout(() => onboardPamem(onboardArgs, context, { quiet: true }));
    const report = setupReport({ ...parsed, workspace: realpathSync(parsed.workspace) });
    report.output = output.trim().split(/\r?\n/).filter(Boolean);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  onboardPamem(onboardArgs, context);

  const workspace = realpathSync(parsed.workspace);
  const configFile = parsed.agentHomeMode ? join(workspace, 'config.toml') : join(workspace, '.pamem', 'config.toml');
  console.log(`Set up pamem ${parsed.agentHomeMode ? 'agent home' : 'workspace'} ${workspace} with profile=${parsed.profile}`);
  console.log(`Config: ${configFile}`);
  console.log(`Memory repo: ${memoryRepoRoot(workspace)}`);
}

export function setupUsage() {
  console.log(`Usage: pamem setup <workspace> --profile <role> [--runtime cli|slock] [--agent-id <id>] [--memory-repo <path>] [--sync-remote <target>] [--sync-ref <ref>] [--git-author-name <name>] [--git-author-email <email>] [--agent-home] [--force] [--json]

Set up a pamem workspace or agent home for an external bootstrapper. This is a
stable component-facing wrapper around intentional onboarding: it requires an
explicit profile, writes or replaces pamem config only when allowed, installs
managed runtime bootstrap files, and prints a machine-readable report with
--json. Use install/repair for bootstrap refresh without role changes.`);
}

function parseSetupArgs(args) {
  if (args.length < 1) {
    setupUsage();
    process.exit(2);
  }
  if (args[0] === '-h' || args[0] === '--help') {
    setupUsage();
    process.exit(0);
  }

  const parsed = {
    workspace: args[0],
    profile: '',
    runtime: 'cli',
    agentHomeMode: false,
    force: false,
    json: false,
    forwarded: [],
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--agent-home') {
      parsed.agentHomeMode = true;
      continue;
    }
    if (arg === '--force') {
      parsed.force = true;
      continue;
    }
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      setupUsage();
      process.exit(0);
    }

    const option = parseForwardedOption(arg, args, index);
    if (option) {
      index = option.index;
      if (option.name === '--profile') parsed.profile = option.value;
      if (option.name === '--runtime') parsed.runtime = option.value;
      parsed.forwarded.push(option.name, option.value);
      continue;
    }

    fail(`unknown setup argument: ${arg}`);
  }

  if (!parsed.profile) fail('pamem setup requires --profile <onboarding|coder|reviewer|researcher>');
  if (!supportedRoles.includes(parsed.profile)) fail(`unsupported profile: ${parsed.profile}`);
  if (!supportedRuntimes.includes(parsed.runtime)) fail(`unsupported runtime mode: ${parsed.runtime}`);

  return parsed;
}

function parseForwardedOption(arg, args, index) {
  const names = [
    '--profile',
    '--runtime',
    '--agent-id',
    '--memory-repo',
    '--sync-remote',
    '--sync-ref',
    '--git-author-name',
    '--git-author-email',
  ];
  for (const name of names) {
    if (arg === name) {
      if (index + 1 >= args.length) fail(`missing value for ${name}`);
      return { name, value: args[index + 1], index: index + 1 };
    }
    if (arg.startsWith(`${name}=`)) {
      return { name, value: arg.slice(name.length + 1), index };
    }
  }
  return null;
}

function setupReport(parsed) {
  const configFile = parsed.agentHomeMode ? join(parsed.workspace, 'config.toml') : join(parsed.workspace, '.pamem', 'config.toml');
  return {
    status: 'ok',
    command: 'setup',
    downstream_execution: 'pamem-onboard',
    workspace: parsed.workspace,
    kind: parsed.agentHomeMode ? 'agent-home' : 'workspace',
    profile: tomlValue(configFile, '', 'default_profile'),
    runtime: tomlValue(configFile, 'runtime', 'mode'),
    agent_id: tomlValue(configFile, 'runtime', 'agent_id'),
    config: configFile,
    memory_repo: memoryRepoRoot(parsed.workspace),
    writes: [
      parsed.agentHomeMode ? 'config.toml' : '.pamem/config.toml',
      'managed runtime bootstrap files',
      'runtime-local task files',
      'memory repo skeleton when missing',
    ],
  };
}

function captureStdout(callback) {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = function write(chunk, encoding, cb) {
    output += typeof chunk === 'string' ? chunk : chunk.toString(encoding);
    if (typeof cb === 'function') cb();
    return true;
  };
  try {
    callback();
    return output;
  } finally {
    process.stdout.write = originalWrite;
  }
}
