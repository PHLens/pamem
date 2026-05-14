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

  assertNoPersonalFixtures();

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
  const homeRoot = join(tmpRoot, 'home');
  const userSkillsRoot = join(homeRoot, 'skills');
  const docReviewSource = join(userSkillsRoot, 'doc-review');
  const agentId = 'smoke-agent';
  const agentHome = join(xdgRoot, 'pamem', 'agents', agentId);
  const memoryRoot = join(xdgRoot, 'pamem', 'memory');
  const env = { XDG_DATA_HOME: xdgRoot, HOME: homeRoot };

  for (const dir of [workspace, removeWorkspace, slockWorkspace, packageSlockWorkspace]) {
    mkdirSync(dir, { recursive: true });
  }
  mkdirSync(docReviewSource, { recursive: true });
  writeFileSync(join(docReviewSource, 'SKILL.md'), '# Doc Review\n');

  // Workspace bootstrap creates runtime links, selected config, local task
  // files, and the shared memory skeleton.
  const install = pamemRun(['install', workspace], { env });
  assert.match(install.stdout, /Shared memory repo initialized/);
  assert.match(install.stdout, /--sync-remote <git-url>/);
  assert.match(install.stdout, /--git-author-name <name> --git-author-email <email>/);

  assertFile(join(workspace, '.pamem', 'config.toml'));
  assertFile(join(workspace, 'MEMORY.md'));
  assertFile(join(workspace, 'notes', 'current-task.md'));
  assertFile(join(workspace, 'notes', 'work-log.md'));
  assertLinkTarget(join(workspace, '.pamem', 'scripts'), join(root, 'scripts'));
  assertLinkTarget(join(workspace, '.pamem', 'assets'), join(root, 'assets'));
  assertIncludes(join(workspace, '.pamem', 'config.toml'), 'default_profile = "onboarding"');
  assertIncludes(join(workspace, '.pamem', 'config.toml'), 'mode = "cli"');
  assertIncludes(join(workspace, '.pamem', 'config.toml'), '[memory_repo.git]');
  assertIncludes(join(workspace, '.pamem', 'config.toml'), 'author_name = ""');
  assertIncludes(join(workspace, '.pamem', 'config.toml'), 'author_email = ""');
  assertNoMatch(join(workspace, '.pamem', 'config.toml'), /backend[ \t]*=/);

  for (const skill of ['memory-lint', 'memory-rule', 'sync-request']) {
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
  assert.equal(pkg.version, '0.9.0');
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
    'lib/skills.mjs',
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
    '--git-author-name',
    'Memory Bot',
    '--git-author-email',
    'memory-bot@example.invalid',
  ], { env });
  assert.match(onboard.stdout, /Onboarded pamem workspace/);
  assert.doesNotMatch(onboard.stdout, /Next: configure shared memory git settings/);
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'default_profile = "researcher"');
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'mode = "slock"');
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'agent_id = "onboard-smoke"');
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), `path = "${customMemoryRoot}"`);
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'remote = "origin"');
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'ref = "main"');
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'executor = "sync-bot"');
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'author_name = "Memory Bot"');
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'author_email = "memory-bot@example.invalid"');
  assertFile(join(customMemoryRoot, 'MEMORY.md'));
  assert.equal(run('git', ['-C', customMemoryRoot, 'config', '--local', 'user.name']).stdout.trim(), 'Memory Bot');
  assert.equal(run('git', ['-C', customMemoryRoot, 'config', '--local', 'user.email']).stdout.trim(), 'memory-bot@example.invalid');
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
  for (const skill of ['memory-lint', 'memory-rule', 'sync-request']) {
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

  const cliList = pamemRun(['list'], { env }).stdout;
  assert.match(cliList, /agent_id\truntime\trole\thome/);
  assert.match(cliList, new RegExp(`${escapeRegExp(agentId)}\\tcli\\twiki\\t${escapeRegExp(agentHome)}`));
  const cliListJson = JSON.parse(pamemRun(['list', '--json'], { env }).stdout);
  assert.equal(cliListJson.agents_dir, join(xdgRoot, 'pamem', 'agents'));
  assert.deepEqual(cliListJson.agents.map((agent) => agent.agent_id), [agentId]);
  assert.equal(cliListJson.agents[0].runtime, 'cli');
  assert.equal(cliListJson.agents[0].role, 'wiki');
  assert.equal(cliListJson.agents[0].home, agentHome);
  assert.equal(cliListJson.agents[0].config, join(agentHome, 'config.toml'));

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
  assert.deepEqual(cliLint.config.git_author, {
    name: '',
    email: '',
    applied_name: '',
    applied_email: '',
  });

  const cliSkillList = pamemRun(['skill', 'list', '--agent-id', agentId], { env }).stdout;
  assert.match(cliSkillList, /status=ok/);
  assert.match(cliSkillList, /codex_skills=memory-lint,memory-rule,sync-request/);
  assert.match(cliSkillList, /pamem_runtime=present/);

  const addSkill = JSON.parse(pamemRun(['skill', 'add', 'doc-review', '--agent-id', agentId, '--json'], { env }).stdout);
  assert.equal(addSkill.action, 'add');
  assert.equal(addSkill.skill.name, 'doc-review');
  assert.equal(addSkill.skill.source, docReviewSource);
  assert.equal(addSkill.codex.action, 'added');
  assert.equal(addSkill.claude.action, 'added');
  assertLinkTarget(join(agentHome, '.codex', 'skills', 'doc-review'), docReviewSource);
  assertLinkTarget(join(agentHome, '.claude', 'skills', 'doc-review'), docReviewSource);

  const addSkillAgain = JSON.parse(pamemRun(['skill', 'add', 'doc-review', '--agent-id', agentId, '--json'], { env }).stdout);
  assert.equal(addSkillAgain.codex.action, 'present');
  assert.equal(addSkillAgain.claude.action, 'present');
  assert.notEqual(pamemTry(['skill', 'add', 'memory-rule', '--agent-id', agentId], { env }).status, 0);

  rmSync(docReviewSource, { recursive: true, force: true });
  const removeBrokenSkill = JSON.parse(pamemRun(['skill', 'remove', 'doc-review', '--agent-id', agentId, '--json'], { env }).stdout);
  assert.equal(removeBrokenSkill.codex.action, 'removed');
  assert.equal(removeBrokenSkill.claude.action, 'removed');
  assertMissing(join(agentHome, '.codex', 'skills', 'doc-review'), 'skill remove should remove a broken Codex symlink');
  assertMissing(join(agentHome, '.claude', 'skills', 'doc-review'), 'skill remove should remove a broken Claude symlink');
  mkdirSync(docReviewSource, { recursive: true });
  writeFileSync(join(docReviewSource, 'SKILL.md'), '# Doc Review\n');
  pamemRun(['skill', 'add', 'doc-review', '--agent-id', agentId, '--json'], { env });

  const cliSkillInspect = JSON.parse(pamemRun(['skill', 'inspect', '--agent-id', agentId, '--json'], { env }).stdout);
  assert.equal(cliSkillInspect.status, 'ok');
  assert.equal(cliSkillInspect.target.type, 'agent-id');
  assert.equal(cliSkillInspect.target.value, agentId);
  assert.equal(cliSkillInspect.pamem_runtime.kind, 'agent-home');
  assert.equal(cliSkillInspect.pamem_runtime.codex.codex_hooks_enabled, true);
  assert.equal(cliSkillInspect.pamem_runtime.codex.session_start_hook, true);
  assert.deepEqual(cliSkillInspect.codex.skills.map((skill) => skill.name), ['doc-review', 'memory-lint', 'memory-rule', 'sync-request']);
  assert.equal(cliSkillInspect.codex.skills.filter((skill) => skill.managed).every((skill) => skill.kind === 'symlink' && skill.status === 'present'), true);
  assert.equal(cliSkillInspect.codex.skills.find((skill) => skill.name === 'doc-review')?.managed, false);
  assert.equal(cliSkillInspect.findings.length, 0);

  pamemRun(['skill', 'verify', '--agent-id', agentId, '--json'], { env });

  const removeSkill = JSON.parse(pamemRun(['skill', 'remove', 'doc-review', '--agent-id', agentId, '--json'], { env }).stdout);
  assert.equal(removeSkill.action, 'remove');
  assert.equal(removeSkill.codex.action, 'removed');
  assert.equal(removeSkill.claude.action, 'removed');
  assertMissing(join(agentHome, '.codex', 'skills', 'doc-review'), 'skill remove should remove the Codex symlink');
  assertMissing(join(agentHome, '.claude', 'skills', 'doc-review'), 'skill remove should remove the Claude symlink');
  assertFile(join(docReviewSource, 'SKILL.md'));

  rmSync(join(agentHome, '.codex', 'skills', 'memory-rule'), { force: true });
  const missingSkill = pamemTry(['skill', 'verify', '--agent-id', agentId, '--json'], { env });
  assert.notEqual(missingSkill.status, 0);
  const missingSkillJson = JSON.parse(missingSkill.stdout);
  assert.equal(missingSkillJson.status, 'error');
  assert.ok(missingSkillJson.findings.some((finding) => finding.rule === 'SKILL_MANAGED_MISSING' && finding.path.endsWith('/memory-rule')));
  pamemRun(['repair', agentHome, '--agent-home'], { env });
  assert.equal(JSON.parse(pamemRun(['skill', 'verify', '--agent-id', agentId, '--json'], { env }).stdout).status, 'ok');

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
  assertIncludes(join(slockWorkspace, 'MEMORY.md'), '## Memory Routing');
  assertIncludes(join(slockWorkspace, 'MEMORY.md'), 'Durable memory is loaded from the configured pamem shared memory repo.');
  assertIncludes(join(slockWorkspace, 'MEMORY.md'), '.pamem/config.toml');
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

  replaceInFile(join(slockWorkspace, '.pamem', 'config.toml'), 'author_name = ""', 'author_name = "Memory Bot"');
  replaceInFile(join(slockWorkspace, '.pamem', 'config.toml'), 'author_email = ""', 'author_email = "memory-bot@example.invalid"');
  pamemRun(['launch', '--runtime', 'slock', '--role', 'coder', '--workspace', slockWorkspace], { env });
  assert.equal(run('git', ['-C', memoryRoot, 'config', '--local', 'user.name']).stdout.trim(), 'Memory Bot');
  assert.equal(run('git', ['-C', memoryRoot, 'config', '--local', 'user.email']).stdout.trim(), 'memory-bot@example.invalid');
  const slockAuthorLint = JSON.parse(pamemRun(['lint', '--workspace', slockWorkspace, '--json'], { env }).stdout);
  assert.equal(slockAuthorLint.status, 'ok');
  assert.equal(slockAuthorLint.config.git_author.name, 'Memory Bot');
  assert.equal(slockAuthorLint.config.git_author.email, 'memory-bot@example.invalid');
  assert.equal(slockAuthorLint.config.git_author.applied_name, 'Memory Bot');
  assert.equal(slockAuthorLint.config.git_author.applied_email, 'memory-bot@example.invalid');
  run('git', ['-C', memoryRoot, 'config', '--local', 'user.email', 'wrong@example.invalid']);
  const slockAuthorMismatch = pamemTry(['lint', '--workspace', slockWorkspace, '--json'], { env });
  assert.notEqual(slockAuthorMismatch.status, 0);
  const slockAuthorMismatchJson = JSON.parse(slockAuthorMismatch.stdout);
  assert.equal(slockAuthorMismatchJson.status, 'error');
  assert.ok(slockAuthorMismatchJson.findings.some((finding) => finding.rule === 'ML010' && /author email/.test(finding.title)));
  run('git', ['-C', memoryRoot, 'config', '--local', 'user.email', 'memory-bot@example.invalid']);

  const slockSkillInspect = JSON.parse(pamemRun(['skill', 'inspect', '--workspace', slockWorkspace, '--json'], { env }).stdout);
  assert.equal(slockSkillInspect.status, 'ok');
  assert.equal(slockSkillInspect.target.type, 'workspace');
  assert.equal(slockSkillInspect.pamem_runtime.kind, 'workspace');
  assert.equal(slockSkillInspect.pamem_runtime.workspace_files.pamem_dir, true);
  assert.equal(slockSkillInspect.pamem_runtime.workspace_files.memory_md, true);
  assert.equal(slockSkillInspect.pamem_runtime.codex.session_start_hook, true);

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
  assertIncludes(join(packageSlockWorkspace, 'MEMORY.md'), '## Memory Routing');
  assertIncludes(join(packageSlockWorkspace, 'MEMORY.md'), 'Durable memory is loaded from the configured pamem shared memory repo.');
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

function assertNoPersonalFixtures() {
  const blocked = [
    new RegExp(['pe', 'rcy'].join(''), 'i'),
    new RegExp(['1033', '957037'].join('')),
    /qq\.com/i,
    /\/root\//,
    /\/home\//,
    /~\/\.slock\/agents\//,
    new RegExp(['iZ', 'rj'].join(''), 'i'),
    new RegExp(['0d465', '93c'].join(''), 'i'),
  ];
  for (const file of repoTextFiles()) {
    const content = readFileSync(join(root, file), 'utf8');
    for (const pattern of blocked) {
      assert.doesNotMatch(content, pattern, `${file} must not contain personal or machine-local fixture: ${pattern}`);
    }
  }
}

function repoTextFiles() {
  return run('git', ['ls-files'], { cwd: root }).stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => !file.endsWith('package-lock.json'))
    .filter((file) => !file.endsWith('.png'))
    .filter((file) => !file.endsWith('.jpg'))
    .filter((file) => !file.endsWith('.jpeg'))
    .filter((file) => !file.endsWith('.gif'));
}

function glob(dir, suffix) {
  return readdirSync(join(root, dir))
    .filter((name) => name.endsWith(suffix))
    .map((name) => join(dir, name));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
