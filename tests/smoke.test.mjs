import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
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
  const homeRoot = join(tmpRoot, 'home');
  const xdgRoot = join(tmpRoot, 'xdg');
  const workspace = join(tmpRoot, 'workspace');
  const removeWorkspace = join(tmpRoot, 'remove');
  const slockAgentsRoot = join(homeRoot, '.slock', 'agents');
  const slockAgentId = 'slock-smoke-agent';
  const slockWorkspace = join(slockAgentsRoot, slockAgentId);
  const packageSlockWorkspace = join(tmpRoot, 'package-slock');
  const npmPrefix = join(tmpRoot, 'npm-prefix');
  const agentId = 'smoke-agent';
  const agentHome = join(xdgRoot, 'pamem', 'agents', agentId);
  const memoryRoot = join(xdgRoot, 'pamem', 'memory');
  const env = { HOME: homeRoot, XDG_DATA_HOME: xdgRoot };

  for (const dir of [workspace, removeWorkspace, slockWorkspace, packageSlockWorkspace]) {
    mkdirSync(dir, { recursive: true });
  }

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
  assertIncludes(join(workspace, '.codex', 'config.toml'), 'hooks = true');
  assertNoMatch(join(workspace, '.codex', 'config.toml'), /codex_hooks/);

  for (const skill of ['memory-lint', 'memory-rule']) {
    assertLinkTarget(join(workspace, '.codex', 'skills', skill), join(root, 'skills', skill));
  }
  assertMissing(join(workspace, '.codex', 'skills', 'sync-request'), 'retired sync-request skill must not be installed');
  writeFileSync(join(workspace, '.codex', 'config.toml'), '[features]\ncodex_hooks = true\n');
  pamemRun(['repair', workspace], { env });
  assertIncludes(join(workspace, '.codex', 'config.toml'), 'hooks = true');
  assertNoMatch(join(workspace, '.codex', 'config.toml'), /codex_hooks/);

  assertFile(join(memoryRoot, 'MEMORY.md'));
  assertFile(join(memoryRoot, 'governance', 'constitution.md'));
  assertFile(join(memoryRoot, 'shared', 'preferences.md'));
  assertFile(join(memoryRoot, 'shared', 'operating-rules.md'));
  assertFile(join(memoryRoot, 'shared', 'experience.md'));
  run('git', ['-C', memoryRoot, 'rev-parse', '--is-inside-work-tree']);
  assertMissing(join(memoryRoot, 'roles', 'base'), 'shared memory repo must not materialize base role templates');
  for (const role of ['onboarding', 'coder', 'reviewer', 'researcher']) {
    assertFile(join(memoryRoot, 'roles', role, `${role}.md`));
    assertFile(join(memoryRoot, 'roles', role, 'experience.md'));
  }
  assertMissing(join(memoryRoot, 'roles', 'wiki'), 'wiki role should be folded into researcher');
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
  assertSubcommandHelp();
  const pkg = parseJsonFile(join(root, 'package.json'));
  const claude = parseJsonFile(join(root, '.claude-plugin', 'plugin.json'));
  const codex = parseJsonFile(join(root, '.codex-plugin', 'plugin.json'));
  const marketplace = parseJsonFile(join(root, '.claude-plugin', 'marketplace.json'));
  const claudeHooks = parseJsonFile(join(root, 'hooks', 'hooks.json'));
  assert.equal(pkg.name, '@phlens/pamem');
  assert.equal(pkg.bin.pamem, './bin/pamem.mjs');
  assert.equal(pkg.scripts.test, 'node --test tests/smoke.test.mjs');
  assert.equal(pkg.version, '0.9.2');
  assert.equal(claude.version, pkg.version);
  assert.equal(Object.hasOwn(claude, 'hooks'), false);
  assert.equal(claudeHooks.hooks.SessionStart[0].hooks[0].command, '"${CLAUDE_PLUGIN_ROOT}"/scripts/memory-session-start.sh');
  assert.equal(codex.version, pkg.version);
  assert.equal(marketplace.plugins.find((plugin) => plugin.name === 'pamem')?.version, pkg.version);

  const packList = JSON.parse(run('npm', ['pack', '--dry-run', '--json'], { cwd: root }).stdout);
  const packFiles = new Set(packList[0].files.map((file) => file.path));
  for (const file of [
    'bin/pamem.mjs',
    'lib/cli.mjs',
    'lib/install.mjs',
    'lib/setup.mjs',
    'lib/check.mjs',
    'lib/onboard.mjs',
    'lib/runtime.mjs',
    'assets/config.toml.template',
    'hooks/hooks.json',
    'scripts/memory-session-start.sh',
    'scripts/memory-pre-compact.sh',
    'skills/memory-lint/scripts/memory-lint.sh',
  ]) {
    assert.ok(packFiles.has(file), `npm pack should include ${file}`);
  }
  assert.equal(packFiles.has('assets/config-profiles/wiki.toml.template'), false, 'npm pack should not include retired wiki profile template');
  assert.equal(packFiles.has('skills/sync-request/SKILL.md'), false, 'npm pack should not include retired sync-request skill');
  for (const file of ['lib/update.mjs', 'lib/skills.mjs', 'scripts/install-pamem.sh', 'scripts/repair-pamem.sh', 'scripts/remove-pamem.sh', 'scripts/onboard-pamem.sh', 'scripts/pamem-cli.sh']) {
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
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'author_name = "Memory Bot"');
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'author_email = "memory-bot@example.invalid"');
  assertFile(join(customMemoryRoot, 'MEMORY.md'));
  assert.equal(run('git', ['-C', customMemoryRoot, 'config', '--local', 'user.name']).stdout.trim(), 'Memory Bot');
  assert.equal(run('git', ['-C', customMemoryRoot, 'config', '--local', 'user.email']).stdout.trim(), 'memory-bot@example.invalid');
  const duplicateOnboard = pamemTry(['onboard', onboardWorkspace, '--profile', 'coder'], { env });
  assert.notEqual(duplicateOnboard.status, 0);
  assert.match(duplicateOnboard.stderr, /rerun with --force/);
  const retiredWikiOnboard = pamemTry(['onboard', join(tmpRoot, 'retired-wiki-onboard'), '--profile', 'wiki'], { env });
  assert.notEqual(retiredWikiOnboard.status, 0);
  assert.match(retiredWikiOnboard.stderr, /unsupported profile: wiki/);
  pamemRun(['onboard', onboardWorkspace, '--profile', 'coder', '--runtime', 'cli', '--force'], { env });
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'default_profile = "coder"');
  assertIncludes(join(onboardWorkspace, '.pamem', 'config.toml'), 'mode = "cli"');

  const setupWorkspace = join(tmpRoot, 'setup');
  const setupMemoryRoot = join(tmpRoot, 'setup-memory');
  const setup = JSON.parse(pamemRun([
    'setup',
    setupWorkspace,
    '--profile',
    'researcher',
    '--runtime',
    'slock',
    '--agent-id',
    'setup-smoke',
    '--memory-repo',
    setupMemoryRoot,
    '--json',
  ], { env }).stdout);
  assert.equal(setup.status, 'ok');
  assert.equal(setup.command, 'setup');
  assert.equal(setup.downstream_execution, 'pamem-onboard');
  assert.equal(setup.profile, 'researcher');
  assert.equal(setup.runtime, 'slock');
  assert.equal(setup.agent_id, 'setup-smoke');
  assert.equal(setup.memory_repo, setupMemoryRoot);
  assertIncludes(join(setupWorkspace, '.pamem', 'config.toml'), 'default_profile = "researcher"');
  assertIncludes(join(setupWorkspace, '.pamem', 'config.toml'), 'mode = "slock"');
  assertIncludes(join(setupWorkspace, '.pamem', 'config.toml'), 'agent_id = "setup-smoke"');
  assertFile(join(setupMemoryRoot, 'MEMORY.md'));
  const setupWithoutProfile = pamemTry(['setup', join(tmpRoot, 'setup-no-profile')], { env });
  assert.notEqual(setupWithoutProfile.status, 0);
  assert.match(setupWithoutProfile.stderr, /pamem setup requires --profile/);
  const retiredWikiSetup = pamemTry(['setup', join(tmpRoot, 'retired-wiki-setup'), '--profile', 'wiki'], { env });
  assert.notEqual(retiredWikiSetup.status, 0);
  assert.match(retiredWikiSetup.stderr, /unsupported profile: wiki/);

  run('npm', ['install', '--global', '--prefix', npmPrefix, root]);
  const installedPamem = join(npmPrefix, 'bin', 'pamem');
  const installedPackageRoot = dirname(dirname(realpathSync(installedPamem)));
  assert.match(run(installedPamem, ['--help']).stdout, /Usage: pamem <command> \[options\]/);

  // User-facing runtime management has moved to Noesis. Retired pamem commands
  // fail with a migration hint and do not mutate existing bootstrap files.
  pamemRun(['install', removeWorkspace], { env });
  const retiredRemove = pamemTry(['remove', removeWorkspace], { env });
  assert.equal(retiredRemove.status, 2);
  assert.match(retiredRemove.stderr, /moved to noesis remove/);
  const removeHooks = parseJsonFile(join(removeWorkspace, '.codex', 'hooks.json'));
  assertHasHookCommand(removeHooks, '.pamem/scripts/memory-session-start.sh');
  for (const skill of ['memory-lint', 'memory-rule']) {
    assertLinkTarget(join(removeWorkspace, '.codex', 'skills', skill), join(root, 'skills', skill));
  }
  assert.equal(pamemTry(['list'], { env }).status, 2);
  assert.match(pamemTry(['help', 'list'], { env }).stderr, /moved to noesis list/);
  const retiredWikiLaunch = pamemTry(['launch', '--role', 'wiki', '--agent-id', 'retired-wiki-agent'], { env });
  assert.equal(retiredWikiLaunch.status, 2);
  assert.match(retiredWikiLaunch.stderr, /moved to noesis launch/);
  assertMissing(join(xdgRoot, 'pamem', 'agents', 'retired-wiki-agent'), 'retired pamem launch must not create agent homes');

  // Agent-home component setup and read-only runtime state surfaces.
  const agentSetup = JSON.parse(pamemRun([
    'setup',
    agentHome,
    '--agent-home',
    '--profile',
    'researcher',
    '--runtime',
    'cli',
    '--agent-id',
    agentId,
    '--json',
  ], { env }).stdout);
  assert.equal(agentSetup.status, 'ok');
  assert.equal(agentSetup.kind, 'agent-home');
  assert.equal(agentSetup.agent_id, agentId);
  assertFile(join(agentHome, 'config.toml'));
  assertFile(join(agentHome, 'current-task.md'));
  assertFile(join(agentHome, 'work-log.md'));
  assertIncludes(join(agentHome, 'config.toml'), 'default_profile = "researcher"');
  assertIncludes(join(agentHome, 'config.toml'), 'mode = "cli"');
  assertNoMatch(join(agentHome, 'config.toml'), /backend[ \t]*=/);
  const cliSession = {
    version: 1,
    session_id: '11111111-1111-4111-8111-111111111111',
    agent_id: agentId,
    root: agentHome,
    local_dir: agentHome,
    current_task: join(agentHome, 'current-task.md'),
    work_log: join(agentHome, 'work-log.md'),
    last_action: 'resume',
    updated_at: '2026-06-02T06:00:00Z',
    last_command: ['codex', '--dangerously-bypass-approvals-and-sandbox'],
  };
  writeJsonFile(join(agentHome, 'session.json'), cliSession);

  const cliStatusJson = JSON.parse(pamemRun(['status', '--agent-id', agentId, '--json'], { env }).stdout);
  assert.equal(cliStatusJson.status, 'ok');
  assert.equal(cliStatusJson.kind, 'agent-home');
  assert.equal(cliStatusJson.root, agentHome);
  assert.equal(cliStatusJson.runtime, 'cli');
  assert.equal(cliStatusJson.role, 'researcher');
  assert.equal(cliStatusJson.agent_id, agentId);
  assert.equal(cliStatusJson.config, join(agentHome, 'config.toml'));
  assert.equal(cliStatusJson.memory_repo, memoryRoot);
  assert.equal(cliStatusJson.memory_entry, join(memoryRoot, 'MEMORY.md'));
  assert.equal(cliStatusJson.current_task, join(agentHome, 'current-task.md'));
  assert.equal(cliStatusJson.work_log, join(agentHome, 'work-log.md'));
  assert.equal(cliStatusJson.agent_home, agentHome);
  assert.equal(cliStatusJson.local_dir, agentHome);
  assert.equal(cliStatusJson.session_file, join(agentHome, 'session.json'));
  assert.equal(cliStatusJson.session_id, cliSession.session_id);
  assert.equal(cliStatusJson.last_action, 'resume');
  assert.match(cliStatusJson.session_updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(cliStatusJson.last_command, cliSession.last_command);

  const cliStatus = pamemRun(['status', '--agent-id', agentId], { env }).stdout;
  assert.match(cliStatus, new RegExp(`root=${escapeRegExp(agentHome)}`));
  assert.match(cliStatus, /runtime=cli/);
  assert.match(cliStatus, new RegExp(`memory_repo=${escapeRegExp(memoryRoot)}`));
  assert.match(cliStatus, new RegExp(`session_id=${escapeRegExp(cliSession.session_id)}`));
  assert.match(cliStatus, /last_command=codex --dangerously-bypass-approvals-and-sandbox/);

  const cliEnv = pamemRun(['status', '--agent-id', agentId, '--print-env'], { env }).stdout;
  assert.match(cliEnv, new RegExp(`export PAMEM_WORKSPACE=${escapeRegExp(agentHome)}`));
  assert.match(cliEnv, new RegExp(`export PAMEM_SESSION_ID=${escapeRegExp(cliSession.session_id)}`));
  assert.match(cliEnv, /export PAMEM_RESUME=0/);

  const cliHookJson = JSON.parse(pamemRun(['hook-json', '--agent-id', agentId], { env }).stdout);
  assert.equal(cliHookJson.cwd, agentHome);
  assert.equal(cliHookJson.pamem.runtime, 'cli');
  assert.equal(cliHookJson.pamem.current_task, join(agentHome, 'current-task.md'));
  assert.equal(cliHookJson.pamem.work_log, join(agentHome, 'work-log.md'));
  assert.equal(cliHookJson.pamem.session_id, cliSession.session_id);

  const cliContext = pamemRun(['context', '--agent-id', agentId], { env }).stdout;
  assert.match(cliContext, /Persistent memory source:/);
  assert.match(cliContext, /Source: `roles\/researcher\/researcher.md`/);
  assert.doesNotMatch(cliContext, /Source: `roles\/base\/base.md`/);
  assert.match(cliContext, /CLI runtime current task source:/);

  const cliLint = JSON.parse(pamemRun(['lint', '--agent-id', agentId, '--json'], { env }).stdout);
  assert.equal(cliLint.status, 'ok');
  assert.equal(cliLint.summary.error_count, 0);
  assert.equal(cliLint.config_scope, 'agent-local');
  assert.equal(cliLint.config.default_profile, 'researcher');
  assert.deepEqual(cliLint.config.git_author, {
    name: '',
    email: '',
    applied_name: '',
    applied_email: '',
  });

  const missingSkillPath = join(agentHome, '.codex', 'skills', 'memory-rule');
  rmSync(join(agentHome, '.codex', 'skills', 'memory-rule'), { force: true });
  assertMissing(missingSkillPath, 'removed managed skill link should be absent before repair');
  pamemRun(['repair', agentHome, '--agent-home'], { env });
  assertLinkTarget(missingSkillPath, join(root, 'skills', 'memory-rule'));
  const removedSkillCommand = pamemTry(['skill', 'list', '--agent-id', agentId], { env });
  assert.notEqual(removedSkillCommand.status, 0);
  assert.match(removedSkillCommand.stderr, /unknown pamem command: skill/);

  const retiredUpdate = pamemTry(['update', '--help'], { env });
  assert.equal(retiredUpdate.status, 2);
  assert.match(retiredUpdate.stderr, /pamem update has moved to noesis update/);
  assert.match(retiredUpdate.stderr, /Noesis-managed package and component maintenance/);
  assert.equal(pamemTry(['update', '--dry-run'], { env }).status, 2);

  // Slock mode keeps task state in the Slock workspace and loads shared memory
  // through the selected profile.
  writeFileSync(join(slockWorkspace, 'MEMORY.md'), `# Existing Slock Agent

## Memory Governance
old workspace governance block

## Role
coder

## Old Sync Notes
old workspace propagation block

## Key Knowledge
- existing workspace note
`);

  pamemRun([
    'setup',
    slockWorkspace,
    '--profile',
    'coder',
    '--runtime',
    'slock',
    '--agent-id',
    slockAgentId,
  ], { env });
  assertFile(join(slockWorkspace, '.pamem', 'config.toml'));
  assertFile(join(slockWorkspace, 'MEMORY.md'));
  assertFile(join(slockWorkspace, 'notes', 'current-task.md'));
  assertFile(join(slockWorkspace, 'notes', 'work-log.md'));
  assertIncludes(join(slockWorkspace, '.pamem', 'config.toml'), 'default_profile = "coder"');
  assertIncludes(join(slockWorkspace, '.pamem', 'config.toml'), 'mode = "slock"');
  assertIncludes(join(slockWorkspace, '.pamem', 'config.toml'), `agent_id = "${slockAgentId}"`);
  assertNoMatch(join(slockWorkspace, '.pamem', 'config.toml'), /backend[ \t]*=/);
  assertIncludes(join(slockWorkspace, 'MEMORY.md'), '# Existing Slock Agent');
  assertIncludes(join(slockWorkspace, 'MEMORY.md'), '## Memory Routing');
  assertIncludes(join(slockWorkspace, 'MEMORY.md'), 'Durable memory is loaded from the configured pamem shared memory repo.');
  assertIncludes(join(slockWorkspace, 'MEMORY.md'), '.pamem/config.toml');
  assertIncludes(join(slockWorkspace, 'MEMORY.md'), 'existing workspace note');
  assertIncludes(join(slockWorkspace, 'MEMORY.md'), 'old workspace governance block');
  assertIncludes(join(slockWorkspace, 'MEMORY.md'), 'old workspace propagation block');

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

  const slockStatusJson = JSON.parse(pamemRun(['status', '--workspace', slockWorkspace, '--json'], { env }).stdout);
  assert.equal(slockStatusJson.status, 'ok');
  assert.equal(slockStatusJson.kind, 'workspace');
  assert.equal(slockStatusJson.root, slockWorkspace);
  assert.equal(slockStatusJson.runtime, 'slock');
  assert.equal(slockStatusJson.role, 'coder');
  assert.equal(slockStatusJson.agent_id, slockAgentId);
  assert.equal(slockStatusJson.memory_repo, memoryRoot);
  assert.equal(slockStatusJson.current_task, join(slockWorkspace, 'notes', 'current-task.md'));
  assert.equal(slockStatusJson.work_log, join(slockWorkspace, 'notes', 'work-log.md'));
  assert.equal(slockStatusJson.agent_home, join(xdgRoot, 'pamem', 'agents', slockStatusJson.agent_id));
  const slockStatusByIdJson = JSON.parse(pamemRun(['status', '--agent-id', slockAgentId, '--json'], { env }).stdout);
  assert.equal(slockStatusByIdJson.root, slockWorkspace);
  assert.equal(slockStatusByIdJson.kind, 'workspace');
  const slockStatusById = pamemRun(['status', '--agent-id', slockAgentId], { env }).stdout;
  assert.match(slockStatusById, new RegExp(`root=${escapeRegExp(slockWorkspace)}`));
  const memoryProposalPath = join(tmpRoot, 'memory-proposal.json');
  writeJsonFile(memoryProposalPath, validMemoryProposal());
  const memoryProposalCheck = JSON.parse(pamemRun(['check', memoryProposalPath, '--workspace', slockWorkspace, '--json'], { env }).stdout);
  assert.equal(memoryProposalCheck.status, 'ok');
  assert.equal(memoryProposalCheck.component, 'pamem');
  assert.equal(memoryProposalCheck.proposal_type, 'memory_proposal');
  assert.equal(memoryProposalCheck.target_owner, 'pamem');
  assert.equal(memoryProposalCheck.memory_repo, memoryRoot);
  assert.equal(memoryProposalCheck.downstream_execution, 'not-run');
  assert.deepEqual(memoryProposalCheck.writes, []);
  assert.equal(memoryProposalCheck.summary.error_count, 0);
  assert.match(pamemRun(['check', '--help'], { env }).stdout, /Read-only owner gate/);

  const wrongOwnerProposalPath = join(tmpRoot, 'wiki-proposal.json');
  writeJsonFile(wrongOwnerProposalPath, validMemoryProposal({
    proposal_type: 'wiki_proposal',
    target_owner: 'LoreForge',
    target_surface: 'loreforge',
    requested_output: {
      kind: 'wiki_proposal',
      target_owner: 'LoreForge',
      review_required: true,
    },
  }));
  const wrongOwnerProposal = pamemTry(['check', wrongOwnerProposalPath, '--workspace', slockWorkspace, '--json'], { env });
  assert.notEqual(wrongOwnerProposal.status, 0);
  const wrongOwnerProposalJson = JSON.parse(wrongOwnerProposal.stdout);
  assert.equal(wrongOwnerProposalJson.status, 'error');
  assert.ok(wrongOwnerProposalJson.checks.some((item) => item.id === 'proposal.proposal_type'));

  const rawEvidenceProposalPath = join(tmpRoot, 'raw-evidence-proposal.json');
  writeJsonFile(rawEvidenceProposalPath, validMemoryProposal({ transcript: ['raw message should stay outside memory proposals'] }));
  const rawEvidenceProposal = pamemTry(['check', rawEvidenceProposalPath, '--workspace', slockWorkspace, '--json'], { env });
  assert.notEqual(rawEvidenceProposal.status, 0);
  const rawEvidenceProposalJson = JSON.parse(rawEvidenceProposal.stdout);
  assert.ok(rawEvidenceProposalJson.checks.some((item) => item.id === 'proposal.transcript.raw_evidence'));

  replaceInFile(join(slockWorkspace, '.pamem', 'config.toml'), 'author_name = ""', 'author_name = "Memory Bot"');
  replaceInFile(join(slockWorkspace, '.pamem', 'config.toml'), 'author_email = ""', 'author_email = "memory-bot@example.invalid"');
  pamemRun(['repair', slockWorkspace], { env });
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

  // The npm-installed CLI should reuse the same onboarding path for Slock
  // workspaces, while linking runtime files from the installed package payload.
  run(installedPamem, ['setup', packageSlockWorkspace, '--profile', 'reviewer', '--runtime', 'slock'], { env });
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
  assert.equal(pamemTry(['launch', '--runtime', 'cli', '--role', 'coder', '--workspace', slockWorkspace], { env }).status, 2);

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

function assertSubcommandHelp() {
  for (const command of [
    'status',
    'hook-json',
    'context',
    'lint',
    'check',
    'pr-check',
    'install',
    'onboard',
    'setup',
    'repair',
  ]) {
    const help = pamemRun([command, '--help']).stdout;
    assert.match(help, new RegExp(`Usage: pamem ${escapeRegExp(command)}`));
    const helpCommand = pamemRun(['help', command]).stdout;
    assert.equal(helpCommand, help);
  }
  for (const command of ['launch', 'list', 'remove', 'update']) {
    const retired = pamemTry([command, '--help']);
    assert.equal(retired.status, 2);
    assert.match(retired.stderr, new RegExp(`moved to noesis ${command}`));
    const helpCommand = pamemTry(['help', command]);
    assert.equal(helpCommand.status, 2);
    assert.match(helpCommand.stderr, new RegExp(`moved to noesis ${command}`));
  }
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

function writeJsonFile(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function validMemoryProposal(overrides = {}) {
  return {
    schema_version: '0.1',
    proposal_id: '2026-05-19T12-00-00Z__memory_owner__01__memory_proposal',
    proposal_type: 'memory_proposal',
    status: 'pending_review',
    created_at: '2026-05-19T12:00:00.000Z',
    request_id: '2026-05-19T12-00-00Z__memory_owner',
    request_path: 'proposals/2026-05-19T12-00-00Z__memory_owner.json',
    source_refs: [
      {
        kind: 'slock_thread',
        ref: '#heuristic-system:example',
        summary: 'Thread where a durable memory candidate was reviewed.',
      },
    ],
    trigger: {
      kind: 'user_correction',
      summary: 'A memory boundary was corrected.',
    },
    target_owner: 'pamem',
    target_surface: 'pamem',
    review_required: true,
    risk: 'medium',
    summary: 'Record a durable memory owner boundary.',
    rationale: 'The correction affects future memory promotion behavior.',
    candidate_items: [
      {
        id: 'item-1',
        summary: 'Keep the upstream control plane separate from pamem memory ownership.',
        evidence: 'The user clarified the owner boundary in a task thread.',
        candidate_kind: 'memory',
        target_surface: 'pamem',
        risk: 'medium',
        review_required: true,
        reason: 'The boundary is reusable across future memory promotion tasks.',
      },
    ],
    requested_output: {
      kind: 'memory_proposal',
      target_owner: 'pamem',
      review_required: true,
    },
    acceptance_checks: [
      {
        kind: 'promote_check',
        command: 'upstream-proposal-check proposals/example.json --json',
        expected: 'status has no errors before owner review',
        status: 'passed',
      },
    ],
    automation_boundary: {
      mode: 'proposal_only',
      allow_apply: false,
      downstream_execution: 'not-run',
      owner_apply_required: true,
    },
    outcome: {
      status: 'not_applied',
      applied_by: null,
      applied_at: null,
    },
    ...overrides,
  };
}

function assertHasHookCommand(hooksJson, command) {
  const sessionStart = hooksJson.hooks?.SessionStart ?? [];
  const commands = [];
  for (const entry of sessionStart) {
    for (const hook of entry.hooks ?? []) {
      commands.push(hook.command);
    }
  }
  assert.ok(commands.includes(command), `expected hook command ${command}`);
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
    .filter((file) => existsSync(join(root, file)) && lstatSync(join(root, file)).isFile())
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
