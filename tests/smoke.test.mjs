import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pamemBin = join(root, 'bin', 'pamem.mjs');
const pamem = [process.execPath, pamemBin];

test('pamem smoke checks', () => {
  requireCommand('jq', 'jq is required for pamem shell helper checks');

  for (const file of ['bin/pamem.mjs', ...glob('lib', '.mjs')]) {
    run(process.execPath, ['--check', join(root, file)]);
  }
  for (const file of glob('scripts', '.sh')) {
    run('bash', ['-n', join(root, file)]);
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), 'pamem-smoke-'));
  try {
    runSmoke(tmpRoot);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

function runSmoke(tmpRoot) {
  const xdgRoot = join(tmpRoot, 'xdg');
  const workspace = join(tmpRoot, 'workspace');
  const removeWorkspace = join(tmpRoot, 'remove');
  const slockWorkspace = join(tmpRoot, 'slock');
  const packageSlockWorkspace = join(tmpRoot, 'package-slock');
  const npmPrefix = join(tmpRoot, 'npm-prefix');
  const agentId = 'smoke-agent';
  const agentHome = join(xdgRoot, 'pamem', 'agents', agentId);
  const memoryRoot = join(xdgRoot, 'pamem', 'memory');
  const env = { XDG_DATA_HOME: xdgRoot };

  for (const dir of [workspace, removeWorkspace, slockWorkspace, packageSlockWorkspace]) {
    mkdirSync(dir, { recursive: true });
  }

  // Workspace bootstrap creates runtime links, selected config, local task
  // files, and the shared memory skeleton.
  pamemRun(['install', workspace], { env });

  assertFile(join(workspace, '.pamem', 'config.toml'));
  assertFile(join(workspace, 'MEMORY.md'));
  assertFile(join(workspace, 'notes', 'current-task.md'));
  assertFile(join(workspace, 'notes', 'work-log.md'));
  assertLinkTarget(join(workspace, '.pamem', 'scripts'), join(root, 'scripts'));
  assertLinkTarget(join(workspace, '.pamem', 'assets'), join(root, 'assets'));
  assertIncludes(join(workspace, '.pamem', 'config.toml'), 'default_profile = "onboarding"');
  assertIncludes(join(workspace, '.pamem', 'config.toml'), 'mode = "cli"');
  assertNoMatch(join(workspace, '.pamem', 'config.toml'), /backend[ \t]*=/);

  for (const skill of ['memory-rule', 'memory-lint']) {
    assertLinkTarget(join(workspace, '.codex', 'skills', skill), join(root, 'skills', skill));
  }

  assertFile(join(memoryRoot, 'MEMORY.md'));
  assertFile(join(memoryRoot, 'governance', 'constitution.md'));
  assertFile(join(memoryRoot, 'shared', 'preferences.md'));
  assertFile(join(memoryRoot, 'shared', 'operating-rules.md'));
  assertFile(join(memoryRoot, 'shared', 'experience.md'));
  run('git', ['-C', memoryRoot, 'rev-parse', '--is-inside-work-tree']);
  assertMissing(join(memoryRoot, 'roles', 'base'), 'shared memory repo must not materialize base role templates');
  for (const role of ['onboarding', 'coder', 'reviewer', 'researcher', 'wiki']) {
    assertFile(join(memoryRoot, 'roles', role, `${role}.md`));
    assertFile(join(memoryRoot, 'roles', role, 'experience.md'));
  }
  assertNoMatch(join(memoryRoot, 'roles', 'onboarding', 'onboarding.md'), /{{ROLE_/);

  run('git', ['-C', memoryRoot, 'config', 'user.email', 'pamem-smoke@example.invalid']);
  run('git', ['-C', memoryRoot, 'config', 'user.name', 'pamem smoke']);
  run('git', ['-C', memoryRoot, 'add', '.']);
  if (tryRun('git', ['-C', memoryRoot, 'diff', '--cached', '--quiet']).status !== 0) {
    run('git', ['-C', memoryRoot, 'commit', '-m', 'Initial smoke memory']);
  } else if (tryRun('git', ['-C', memoryRoot, 'rev-parse', '--verify', 'HEAD']).status !== 0) {
    assert.fail('shared memory repo needs an initial commit for pr-check smoke');
  }

  assertMissing(join(memoryRoot, 'agents'), 'shared memory must not contain plugin-owned agents');
  for (const layer of ['L0', 'L1', 'L2', 'L3']) {
    assertMissing(join(memoryRoot, layer), `shared memory must use semantic paths, not ${layer}`);
  }
  assert.equal(Object.hasOwn(parseJsonFile(join(workspace, '.codex', 'hooks.json')).hooks ?? {}, 'PreCompact'), false);

  assert.match(pamemRun(['--help']).stdout, /Usage: pamem <command> \[options\]/);
  const pkg = parseJsonFile(join(root, 'package.json'));
  const claude = parseJsonFile(join(root, '.claude-plugin', 'plugin.json'));
  const codex = parseJsonFile(join(root, '.codex-plugin', 'plugin.json'));
  const marketplace = parseJsonFile(join(root, '.claude-plugin', 'marketplace.json'));
  assert.equal(pkg.name, '@phlens/pamem');
  assert.equal(pkg.bin.pamem, './bin/pamem.mjs');
  assert.equal(pkg.scripts.test, 'node --test tests/smoke.test.mjs');
  assert.equal(pkg.version, '0.7.0');
  assert.equal(claude.version, pkg.version);
  assert.equal(codex.version, pkg.version);
  assert.equal(marketplace.plugins.find((plugin) => plugin.name === 'pamem')?.version, pkg.version);

  const packList = JSON.parse(run('npm', ['pack', '--dry-run', '--json'], { cwd: root }).stdout);
  const packFiles = new Set(packList[0].files.map((file) => file.path));
  for (const file of [
    'bin/pamem.mjs',
    'lib/cli.mjs',
    'lib/install.mjs',
    'lib/onboard.mjs',
    'lib/runtime.mjs',
    'assets/config.toml.template',
    'scripts/memory-session-start.sh',
    'scripts/memory-pre-compact.sh',
    'skills/memory-lint/scripts/memory-lint.sh',
  ]) {
    assert.ok(packFiles.has(file), `npm pack should include ${file}`);
  }
  for (const file of ['scripts/install-pamem.sh', 'scripts/repair-pamem.sh', 'scripts/remove-pamem.sh', 'scripts/onboard-pamem.sh', 'scripts/pamem-cli.sh']) {
    assert.equal(packFiles.has(file), false, `npm pack should not include removed script ${file}`);
  }

  const onboardWorkspace = join(tmpRoot, 'onboard');
  const customMemoryRoot = join(tmpRoot, 'custom-memory');
  const onboard = pamemRun([
    'onboard',
    onboardWorkspace,
    '--profile',
    'researcher',
    '--runtime',
    'slock',
    '--agent-id',
    'onboard-smoke',
    '--memory-repo',
    customMemoryRoot,
    '--sync-remote',
    'origin',
    '--sync-ref',
    'main',
    '--sync-executor',
    'sync-bot',
  ], { env });
  assert.match(onboard.stdout, /Onboarded pamem workspace/);
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'default_profile = "researcher"');
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'mode = "slock"');
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'agent_id = "onboard-smoke"');
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), `path = "${customMemoryRoot}"`);
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'remote = "origin"');
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'ref = "main"');
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'executor = "sync-bot"');
  assertFile(join(customMemoryRoot, 'MEMORY.md'));
  const duplicateOnboard = pamemTry(['onboard', onboardWorkspace, '--profile', 'wiki'], { env });
  assert.notEqual(duplicateOnboard.status, 0);
  assert.match(duplicateOnboard.stderr, /rerun with --force/);
  pamemRun(['onboard', onboardWorkspace, '--profile', 'wiki', '--runtime', 'cli', '--force'], { env });
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'default_profile = "wiki"');
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'mode = "cli"');

  run('npm', ['install', '--global', '--prefix', npmPrefix, root]);
  const installedPamem = join(npmPrefix, 'bin', 'pamem');
  const installedPackageRoot = dirname(dirname(realpathSync(installedPamem)));
  assert.match(run(installedPamem, ['--help']).stdout, /Usage: pamem <command> \[options\]/);

  // Removal only clears managed hook and skill entries. It leaves workspace
  // memory and config in place for later repair.
  pamemRun(['install', removeWorkspace], { env });
  pamemRun(['remove', removeWorkspace], { env });
  const removeHooks = parseJsonFile(join(removeWorkspace, '.codex', 'hooks.json'));
  assertNoHookCommand(removeHooks, '.pamem/scripts/memory-session-start.sh');
  for (const skill of ['memory-rule', 'memory-lint']) {
    assertMissing(join(removeWorkspace, '.codex', 'skills', skill), `pamem remove must remove managed skill link: ${skill}`);
  }

  // Agent-home launch and CLI lifecycle.
  pamemRun(['launch', '--role', 'wiki', '--agent-id', agentId], { env });
  assertFile(join(agentHome, 'config.toml'));
  assertFile(join(agentHome, 'current-task.md'));
  assertFile(join(agentHome, 'work-log.md'));
  assertIncludes(join(agentHome, 'config.toml'), 'default_profile = "wiki"');
  assertIncludes(join(agentHome, 'config.toml'), 'mode = "cli"');
  assertNoMatch(join(agentHome, 'config.toml'), /backend[ \t]*=/);

  const sessionTest = 'test "$PWD" = "$PAMEM_WORKSPACE" && test -s "$PAMEM_CURRENT_TASK" && if [ "$PAMEM_RESUME" = 1 ]; then printf resume > "$PAMEM_LOCAL_DIR/resume-marker"; else printf start > "$PAMEM_LOCAL_DIR/start-marker"; fi';
  pamemRun(['launch', '--role', 'wiki', '--agent-id', agentId, '--', 'sh', '-c', sessionTest], { env });
  assertFile(join(agentHome, 'start-marker'));
  pamemRun(['launch', '--role', 'wiki', '--agent-id', agentId, '--resume'], { env });
  assertFile(join(agentHome, 'resume-marker'));
  assert.notEqual(pamemTry(['launch', '--role', 'coder', '--agent-id', agentId], { env }).status, 0);

  const cliStatus = pamemRun(['status', '--agent-id', agentId], { env }).stdout;
  assert.match(cliStatus, new RegExp(`root=${escapeRegExp(agentHome)}`));
  assert.match(cliStatus, /runtime=cli/);
  assert.match(cliStatus, new RegExp(`memory_repo=${escapeRegExp(memoryRoot)}`));
  assert.match(cliStatus, /last_command=sh -c/);

  const cliEnv = pamemRun(['status', '--agent-id', agentId, '--print-env'], { env }).stdout;
  assert.match(cliEnv, new RegExp(`export PAMEM_WORKSPACE=${escapeRegExp(agentHome)}`));
  assert.match(cliEnv, /export PAMEM_RESUME=0/);

  appendFile(join(agentHome, 'config.toml'), '\n[runtime.resume]\ncommand = ["sh", "-c", "printf configured > $PAMEM_LOCAL_DIR/configured-marker"]\n');
  rmSync(join(agentHome, 'resume-marker'), { force: true });
  pamemRun(['launch', '--role', 'wiki', '--agent-id', agentId, '--resume'], { env });
  assertFile(join(agentHome, 'configured-marker'));
  assertMissing(join(agentHome, 'resume-marker'), 'configured resume command should take precedence over last session command');

  const cliHookJson = JSON.parse(pamemRun(['hook-json', '--agent-id', agentId], { env }).stdout);
  assert.equal(cliHookJson.cwd, agentHome);
  assert.equal(cliHookJson.pamem.runtime, 'cli');
  assert.equal(cliHookJson.pamem.current_task, join(agentHome, 'current-task.md'));
  assert.equal(cliHookJson.pamem.work_log, join(agentHome, 'work-log.md'));

  const cliContext = pamemRun(['context', '--agent-id', agentId], { env }).stdout;
  assert.match(cliContext, /Persistent memory source:/);
  assert.match(cliContext, /Source: `roles\/wiki\/wiki.md`/);
  assert.doesNotMatch(cliContext, /Source: `roles\/base\/base.md`/);
  assert.match(cliContext, /CLI runtime current task source:/);

  const cliLint = JSON.parse(pamemRun(['lint', '--agent-id', agentId, '--json'], { env }).stdout);
  assert.equal(cliLint.status, 'ok');
  assert.equal(cliLint.summary.error_count, 0);
  assert.equal(cliLint.config_scope, 'agent-local');
  assert.equal(cliLint.config.default_profile, 'wiki');

  // Slock mode keeps task state in the Slock workspace and loads shared memory
  // through the selected profile.
  writeFileSync(join(slockWorkspace, 'MEMORY.md'), `# Existing Slock Agent

## Memory Governance
old workspace governance block

## Role
coder

## Sync Trigger
old workspace sync block

## Key Knowledge
- existing workspace note
`);

  pamemRun(['launch', '--runtime', 'slock', '--role', 'coder', '--workspace', slockWorkspace], { env });
  assertFile(join(slockWorkspace, '.pamem', 'config.toml'));
  assertFile(join(slockWorkspace, 'MEMORY.md'));
  assertFile(join(slockWorkspace, 'notes', 'current-task.md'));
  assertFile(join(slockWorkspace, 'notes', 'work-log.md'));
  assertIncludes(join(slockWorkspace, '.pamem', 'config.toml'), 'default_profile = "coder"');
  assertIncludes(join(slockWorkspace, '.pamem', 'config.toml'), 'mode = "slock"');
  assertNoMatch(join(slockWorkspace, '.pamem', 'config.toml'), /backend[ \t]*=/);
  assertIncludes(join(slockWorkspace, 'MEMORY.md'), '# Existing Slock Agent');
  assertIncludes(join(slockWorkspace, 'MEMORY.md'), 'existing workspace note');
  assertIncludes(join(slockWorkspace, 'MEMORY.md'), 'old workspace governance block');
  assertIncludes(join(slockWorkspace, 'MEMORY.md'), 'old workspace sync block');

  const slockContext = pamemRun(['context', '--workspace', slockWorkspace], { env }).stdout;
  assert.match(slockContext, /runtime=slock/);
  assert.match(slockContext, /Source: `roles\/coder\/coder.md`/);
  assert.doesNotMatch(slockContext, /Source: `roles\/base\/base.md`/);
  assert.match(slockContext, /Slock runtime current task source:/);
  assert.match(slockContext, /Slock runtime work log source:/);

  const slockLint = JSON.parse(pamemRun(['lint', '--workspace', slockWorkspace, '--json'], { env }).stdout);
  assert.equal(slockLint.status, 'ok');
  assert.equal(slockLint.summary.error_count, 0);
  assert.equal(slockLint.config.runtime_mode, 'slock');

  // The npm-installed CLI should reuse the same onboarding path for Slock
  // workspaces, while linking runtime files from the installed package payload.
  run(installedPamem, ['launch', '--runtime', 'slock', '--role', 'reviewer', '--workspace', packageSlockWorkspace], { env });
  assertFile(join(packageSlockWorkspace, '.pamem', 'config.toml'));
  assertFile(join(packageSlockWorkspace, 'MEMORY.md'));
  assertFile(join(packageSlockWorkspace, 'notes', 'current-task.md'));
  assertFile(join(packageSlockWorkspace, 'notes', 'work-log.md'));
  assertLinkTarget(join(packageSlockWorkspace, '.pamem', 'scripts'), join(installedPackageRoot, 'scripts'));
  assertLinkTarget(join(packageSlockWorkspace, '.pamem', 'assets'), join(installedPackageRoot, 'assets'));
  assertIncludes(join(packageSlockWorkspace, '.pamem', 'config.toml'), 'default_profile = "reviewer"');
  assertIncludes(join(packageSlockWorkspace, '.pamem', 'config.toml'), 'mode = "slock"');
  const packageSlockContext = run(installedPamem, ['context', '--workspace', packageSlockWorkspace], { env }).stdout;
  assert.match(packageSlockContext, /runtime=slock/);
  assert.match(packageSlockContext, /Source: `roles\/reviewer\/reviewer.md`/);

  run('git', ['-C', memoryRoot, 'checkout', '-b', 'smoke-memory-pr']);
  appendFile(join(memoryRoot, 'roles', 'coder', 'experience.md'), '\n## Smoke finding\n');
  run('git', ['-C', memoryRoot, 'add', 'roles/coder/experience.md']);
  run('git', ['-C', memoryRoot, 'commit', '-m', 'Smoke role memory PR']);

  const prCheckOk = JSON.parse(pamemRun(['pr-check', '--workspace', slockWorkspace, '--head', 'HEAD', '--target', 'roles/coder/', '--json'], { env }).stdout);
  assert.equal(prCheckOk.status, 'ok');
  assert.equal(prCheckOk.summary.error_count, 0);
  assert.ok(prCheckOk.diff.changed_files.includes('roles/coder/experience.md'));

  appendFile(join(memoryRoot, 'shared', 'preferences.md'), '\n- Smoke guarded change\n');
  run('git', ['-C', memoryRoot, 'add', 'shared/preferences.md']);
  run('git', ['-C', memoryRoot, 'commit', '-m', 'Smoke guarded memory PR']);

  const prCheckFail = pamemTry(['pr-check', '--workspace', slockWorkspace, '--head', 'HEAD', '--target', 'roles/coder/', '--json'], { env });
  assert.notEqual(prCheckFail.status, 0);
  const prCheckFailJson = JSON.parse(prCheckFail.stdout);
  assert.equal(prCheckFailJson.status, 'error');
  assert.ok(prCheckFailJson.findings.some((finding) => finding.rule === 'MP002' && finding.path === 'shared/preferences.md'));

  const prCheckGuardedOk = JSON.parse(pamemRun([
    'pr-check',
    '--workspace',
    slockWorkspace,
    '--head',
    'HEAD',
    '--target',
    'roles/coder/',
    '--target',
    'shared/',
    '--allow-guarded',
    '--json',
  ], { env }).stdout);
  assert.equal(prCheckGuardedOk.status, 'ok');
  assert.equal(prCheckGuardedOk.diff.allow_guarded, true);
  run('git', ['-C', memoryRoot, 'checkout', 'main']);

  assert.notEqual(pamemTry(['start', '--workspace', slockWorkspace], { env }).status, 0);
  assert.notEqual(pamemTry(['launch', '--runtime', 'cli', '--role', 'coder', '--workspace', slockWorkspace], { env }).status, 0);

  rmSync(join(memoryRoot, 'MEMORY.md'), { force: true });
  const missingContext = pamemRun(['context', '--agent-id', agentId], { env }).stdout;
  assert.match(missingContext, /Warning: configured memory entry file is missing or empty/);
  assert.doesNotMatch(missingContext, /Load and follow this persistent memory index/);

  replaceInFile(join(agentHome, 'config.toml'), 'mode = "cli"', 'mode = "invalid"');
  assert.notEqual(pamemTry(['lint', '--agent-id', agentId, '--json'], { env }).status, 0);
}

function pamemRun(args, options = {}) {
  return run(pamem[0], [...pamem.slice(1), ...args], options);
}

function pamemTry(args, options = {}) {
  return tryRun(pamem[0], [...pamem.slice(1), ...args], options);
}

function run(command, args, options = {}) {
  const result = tryRun(command, args, options);
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed with status ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function tryRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return result;
}

function requireCommand(command, message) {
  const result = spawnSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' });
  assert.equal(result.status, 0, message);
}

function assertFile(file) {
  assert.ok(readFileSync(file, 'utf8').length > 0, `missing or empty file: ${file}`);
}

function assertMissing(file, message) {
  assert.equal(existsSync(file), false, message);
}

function assertLinkTarget(link, target) {
  assert.equal(realpathSync(link), realpathSync(target), `symlink does not resolve to ${target}: ${link}`);
}

function assertIncludes(file, text) {
  assert.ok(readFileSync(file, 'utf8').includes(text), `${file} should include ${text}`);
}

function assertNoMatch(file, pattern) {
  assert.doesNotMatch(readFileSync(file, 'utf8'), pattern, `unexpected match in ${file}: ${pattern}`);
}

function parseJsonFile(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function assertNoHookCommand(hooksJson, command) {
  const sessionStart = hooksJson.hooks?.SessionStart ?? [];
  for (const entry of sessionStart) {
    for (const hook of entry.hooks ?? []) {
      assert.notEqual(hook.command, command);
    }
  }
}

function appendFile(file, text) {
  writeFileSync(file, `${readFileSync(file, 'utf8')}${text}`);
}

function replaceInFile(file, search, replacement) {
  writeFileSync(file, readFileSync(file, 'utf8').replace(search, replacement));
}

function glob(dir, suffix) {
  return readdirSync(join(root, dir))
    .filter((name) => name.endsWith(suffix))
    .map((name) => join(dir, name));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
