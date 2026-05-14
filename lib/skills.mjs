import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { agentHomePath, hasConfig } from './config.mjs';
import { fail } from './process.mjs';

export function runSkillCommand(args, context) {
  const [command, ...rest] = args;
  if (!command || command === '-h' || command === '--help') {
    skillUsage();
    process.exit(0);
  }

  switch (command) {
    case 'add':
      printChange(addSkill(rest, context));
      break;
    case 'remove':
      printChange(removeSkill(rest, context));
      break;
    case 'list':
      printList(resolveSkillState(rest, context));
      break;
    case 'inspect':
      printInspect(resolveSkillState(rest, context));
      break;
    case 'verify':
      printVerify(resolveSkillState(rest, context));
      break;
    default:
      fail(`unknown pamem skill command: ${command}`);
  }
}

export function skillUsage() {
  console.log(`Usage: pamem skill <list|inspect|verify|add|remove> [options]

Read-only skill visibility inspection:
  pamem skill list --agent-id coder-local
  pamem skill inspect --workspace <slock-agent-workspace>
  pamem skill verify --agent-id coder-local --json

Workspace-scoped symlink skill changes:
  pamem skill add doc-review --agent-id coder-local
  pamem skill add doc-review --agent-id coder-local --source ~/skills/doc-review
  pamem skill remove doc-review --agent-id coder-local`);
}

function addSkill(args, context) {
  const parsed = parseSkillArgs(args, context, { skillName: true, source: true });
  requireUnmanagedSkill(parsed.skillName, context, 'add');
  const root = resolveRoot(parsed);
  const source = resolveSkillSource(parsed.skillName, parsed.source);
  return {
    json: parsed.json,
    action: 'add',
    root,
    skill: {
      name: parsed.skillName,
      source,
    },
    codex: linkSkill(source, join(root, '.codex', 'skills', parsed.skillName)),
    claude: linkSkill(source, join(root, '.claude', 'skills', parsed.skillName)),
  };
}

function removeSkill(args, context) {
  const parsed = parseSkillArgs(args, context, { skillName: true });
  requireUnmanagedSkill(parsed.skillName, context, 'remove');
  const root = resolveRoot(parsed);
  return {
    json: parsed.json,
    action: 'remove',
    root,
    skill: {
      name: parsed.skillName,
    },
    codex: unlinkSkill(join(root, '.codex', 'skills', parsed.skillName)),
    claude: unlinkSkill(join(root, '.claude', 'skills', parsed.skillName)),
  };
}

function resolveSkillState(args, context) {
  const parsed = parseSkillArgs(args, context);
  const root = resolveRoot(parsed, context);
  const expectedTargets = managedSkillTargets(context.repoRoot);
  const codexSkills = scanSkillDir(join(root, '.codex', 'skills'), expectedTargets);
  const claudeSkills = scanSkillDir(join(root, '.claude', 'skills'), {});
  const claudePlugins = readClaudePlugins(join(root, '.claude', 'settings.json'));
  const pamemRuntime = inspectPamemRuntime(root);
  const findings = [
    ...codexSkills.findings,
    ...claudeSkills.findings,
    ...claudePlugins.findings,
    ...pamemRuntime.findings,
  ];

  return {
    json: parsed.json,
    root,
    target: parsed.agentId ? { type: 'agent-id', value: parsed.agentId } : { type: 'workspace', value: root },
    codex: {
      skills_dir: codexSkills.dir,
      skills: codexSkills.skills,
    },
    claude: {
      skills_dir: claudeSkills.dir,
      skills: claudeSkills.skills,
      settings: {
        path: join(root, '.claude', 'settings.json'),
        exists: existsSync(join(root, '.claude', 'settings.json')),
        plugins: claudePlugins.plugins,
        readable: claudePlugins.readable,
      },
    },
    pamem_runtime: pamemRuntime.runtime,
    managed_skills: Object.keys(expectedTargets).sort(),
    findings,
    status: findings.some((finding) => finding.severity === 'error') ? 'error' : 'ok',
  };
}

function parseSkillArgs(args, context, options = {}) {
  const parsed = {
    agentId: '',
    workspace: '',
    skillName: '',
    source: '',
    json: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (options.skillName && !parsed.skillName && !arg.startsWith('-')) {
      parsed.skillName = arg;
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
    if (options.source && arg === '--source') {
      if (i + 1 >= args.length) fail('missing value for --source');
      parsed.source = args[++i];
      continue;
    }
    if (options.source && arg.startsWith('--source=')) {
      parsed.source = arg.slice('--source='.length);
      continue;
    }
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      skillUsage();
      process.exit(0);
    }
    fail(`unknown skill argument: ${arg}`);
  }

  if (parsed.agentId && parsed.workspace) {
    fail('use either --agent-id or --workspace, not both');
  }
  if (options.skillName) {
    requireSkillName(parsed.skillName);
  }
  if (!parsed.agentId && !parsed.workspace) {
    parsed.workspace = context.defaultWorkspace || '.';
  }
  return parsed;
}

function requireSkillName(skillName) {
  if (!skillName) fail('missing skill name');
  if (skillName === '.' || skillName === '..' || skillName.includes('/')) {
    fail(`invalid skill name: ${skillName}`);
  }
}

function requireUnmanagedSkill(skillName, context, action) {
  if (Object.hasOwn(managedSkillTargets(context.repoRoot), skillName)) {
    fail(`pamem skill ${skillName} is managed by pamem; use pamem repair/remove rather than skill ${action}`);
  }
}

function resolveRoot(parsed) {
  const root = parsed.agentId ? agentHomePath(parsed.agentId) : parsed.workspace;
  if (!existsSync(root)) {
    fail(`pamem skill target does not exist: ${root}`);
  }
  const resolved = realpathSync(root);
  if (!hasConfig(resolved)) {
    fail(`pamem skill target is not a configured pamem agent home or workspace: ${resolved}`);
  }
  return resolved;
}

function resolveSkillSource(skillName, source) {
  const skillsRoot = resolveHomeSkillsRoot();
  if (source) {
    const resolved = safeRealpath(expandUserPath(source));
    if (!resolved || !isDirectory(resolved)) fail(`skill source is not a directory: ${source}`);
    if (!isWithinDir(resolved, skillsRoot)) {
      fail(`skill source must be under ${skillsRoot}: ${resolved}`);
    }
    return resolved;
  }

  const candidate = join(skillsRoot, skillName);
  const resolved = safeRealpath(candidate);
  if (resolved && isDirectory(resolved)) return resolved;
  fail(`skill source not found: ${candidate}`);
}

function resolveHomeSkillsRoot() {
  const home = process.env.HOME || '';
  if (!home) fail('HOME is not set; pass --source under a configured home skills directory');
  const root = safeRealpath(join(home, 'skills'));
  if (!root) fail(`skill source root not found: ${join(home, 'skills')}`);
  return root;
}

function expandUserPath(path) {
  if (path === '~') return process.env.HOME || '';
  if (path.startsWith('~/')) return join(process.env.HOME || '', path.slice(2));
  return path;
}

function isWithinDir(child, parent) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

function linkSkill(source, link) {
  mkdirSync(dirname(link), { recursive: true });
  const relativeTarget = relative(dirname(link), source) || '.';
  if (pathExists(link)) {
    if (!isSymlink(link)) fail(`skill target exists and is not a symlink: ${link}`);
    const current = safeRealpath(resolve(dirname(link), readlinkSync(link)));
    if (current === source) {
      return { path: link, action: 'present', target: readlinkSync(link), resolved_target: current };
    }
    rmSync(link, { force: true });
    symlinkSync(relativeTarget, link);
    return { path: link, action: 'repaired', target: relativeTarget, resolved_target: source };
  }
  symlinkSync(relativeTarget, link);
  return { path: link, action: 'added', target: relativeTarget, resolved_target: source };
}

function unlinkSkill(link) {
  if (!pathExists(link)) return { path: link, action: 'missing' };
  if (!isSymlink(link)) fail(`skill target exists and is not a symlink: ${link}`);
  const target = readlinkSync(link);
  const resolved = safeRealpath(resolve(dirname(link), target));
  rmSync(link, { force: true });
  return { path: link, action: 'removed', target, resolved_target: resolved };
}

function managedSkillTargets(repoRoot) {
  const skillsDir = join(repoRoot, 'skills');
  const targets = {};
  if (!existsSync(skillsDir)) return targets;
  for (const skill of readdirSync(skillsDir)) {
    const path = join(skillsDir, skill);
    if (lstatSync(path).isDirectory()) targets[skill] = path;
  }
  return targets;
}

function scanSkillDir(dir, expectedTargets) {
  const skills = [];
  const findings = [];

  if (!existsSync(dir)) {
    for (const [name, expected] of Object.entries(expectedTargets)) {
      if (!existsSync(expected)) continue;
      findings.push({
        severity: 'error',
        rule: 'SKILL_MANAGED_MISSING',
        path: join(dir, name),
        expected,
        message: `managed pamem skill is missing: ${name}`,
      });
    }
    return { dir, skills, findings };
  }

  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    const skill = {
      name,
      path,
      kind: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file',
      target: '',
      resolved_target: '',
      managed: Object.hasOwn(expectedTargets, name),
      status: 'present',
    };

    if (stat.isSymbolicLink()) {
      skill.target = readlinkSync(path);
      try {
        skill.resolved_target = realpathSync(resolve(dirname(path), skill.target));
      } catch {
        skill.status = 'broken';
        findings.push({
          severity: 'error',
          rule: 'SKILL_BROKEN_LINK',
          path,
          message: `${path} points to a missing target`,
        });
      }
    }

    if (skill.managed) {
      const expected = safeRealpath(expectedTargets[name]);
      if (!stat.isSymbolicLink()) {
        skill.status = 'conflict';
        findings.push({
          severity: 'error',
          rule: 'SKILL_MANAGED_CONFLICT',
          path,
          message: `${path} is managed by pamem and must be a symlink`,
        });
      } else if (expected && skill.resolved_target !== expected) {
        skill.status = 'mismatched';
        findings.push({
          severity: 'error',
          rule: 'SKILL_MANAGED_MISMATCH',
          path,
          expected,
          actual: skill.resolved_target,
          message: `${path} does not point to the packaged pamem skill`,
        });
      }
    }

    skills.push(skill);
  }

  for (const [name, expected] of Object.entries(expectedTargets)) {
    if (!existsSync(expected)) continue;
    if (skills.some((skill) => skill.name === name)) continue;
    findings.push({
      severity: 'error',
      rule: 'SKILL_MANAGED_MISSING',
      path: join(dir, name),
      expected,
      message: `managed pamem skill is missing: ${name}`,
    });
  }

  return { dir, skills, findings };
}

function inspectPamemRuntime(root) {
  const agentHomeConfig = join(root, 'config.toml');
  const workspaceConfig = join(root, '.pamem', 'config.toml');
  const runtime = {
    kind: existsSync(agentHomeConfig) ? 'agent-home' : 'workspace',
    config: {
      path: existsSync(agentHomeConfig) ? agentHomeConfig : workspaceConfig,
      exists: hasConfig(root),
    },
    codex: {
      config_path: join(root, '.codex', 'config.toml'),
      hooks_path: join(root, '.codex', 'hooks.json'),
      codex_hooks_enabled: false,
      session_start_hook: false,
    },
    workspace_files: {
      pamem_dir: existsSync(join(root, '.pamem')),
      memory_md: existsSync(join(root, 'MEMORY.md')),
      current_task: existsSync(join(root, 'notes', 'current-task.md')) || existsSync(join(root, 'current-task.md')),
      work_log: existsSync(join(root, 'notes', 'work-log.md')) || existsSync(join(root, 'work-log.md')),
    },
  };
  const findings = [];

  if (existsSync(runtime.codex.config_path)) {
    runtime.codex.codex_hooks_enabled = /\bcodex_hooks\s*=\s*true\b/.test(readFileSync(runtime.codex.config_path, 'utf8'));
  } else {
    findings.push({
      severity: 'error',
      rule: 'SKILL_MISSING_CODEX_CONFIG',
      path: runtime.codex.config_path,
      message: 'Codex config is missing',
    });
  }
  if (existsSync(runtime.codex.hooks_path)) {
    try {
      runtime.codex.session_start_hook = hasPamemSessionStartHook(JSON.parse(readFileSync(runtime.codex.hooks_path, 'utf8')));
    } catch {
      findings.push({
        severity: 'error',
        rule: 'SKILL_INVALID_HOOKS_JSON',
        path: runtime.codex.hooks_path,
        message: `${runtime.codex.hooks_path} is not valid JSON`,
      });
    }
  } else {
    findings.push({
      severity: 'error',
      rule: 'SKILL_MISSING_CODEX_HOOKS',
      path: runtime.codex.hooks_path,
      message: 'Codex hooks file is missing',
    });
  }

  if (!runtime.config.exists) {
    findings.push({
      severity: 'error',
      rule: 'SKILL_MISSING_CONFIG',
      path: runtime.config.path,
      message: 'pamem config is missing',
    });
  }
  if (existsSync(runtime.codex.config_path) && !runtime.codex.codex_hooks_enabled) {
    findings.push({
      severity: 'error',
      rule: 'SKILL_CODEX_HOOKS_DISABLED',
      path: runtime.codex.config_path,
      message: 'Codex hooks are not enabled',
    });
  }
  if (existsSync(runtime.codex.hooks_path) && !runtime.codex.session_start_hook) {
    findings.push({
      severity: 'error',
      rule: 'SKILL_MISSING_SESSION_START',
      path: runtime.codex.hooks_path,
      message: 'pamem SessionStart hook is missing',
    });
  }
  if (runtime.kind === 'workspace' && !runtime.workspace_files.memory_md) {
    findings.push({
      severity: 'error',
      rule: 'SKILL_MISSING_MEMORY_MD',
      path: join(root, 'MEMORY.md'),
      message: 'workspace MEMORY.md is missing',
    });
  }
  if (!runtime.workspace_files.current_task) {
    findings.push({
      severity: 'error',
      rule: 'SKILL_MISSING_CURRENT_TASK',
      path: runtime.kind === 'agent-home' ? join(root, 'current-task.md') : join(root, 'notes', 'current-task.md'),
      message: 'runtime current-task file is missing',
    });
  }
  if (!runtime.workspace_files.work_log) {
    findings.push({
      severity: 'error',
      rule: 'SKILL_MISSING_WORK_LOG',
      path: runtime.kind === 'agent-home' ? join(root, 'work-log.md') : join(root, 'notes', 'work-log.md'),
      message: 'runtime work-log file is missing',
    });
  }

  return { runtime, findings };
}

function hasPamemSessionStartHook(hooksJson) {
  const sessionStart = hooksJson?.hooks?.SessionStart;
  if (!Array.isArray(sessionStart)) return false;
  return sessionStart.some((entry) => (
    Array.isArray(entry?.hooks)
    && entry.hooks.some((hook) => typeof hook?.command === 'string' && hook.command.includes('memory-session-start.sh'))
  ));
}

function readClaudePlugins(file) {
  if (!existsSync(file)) return { readable: false, plugins: [], findings: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return { readable: true, plugins: collectStrings(parsed).filter((value) => value.includes('@') || value.includes('/')).sort(), findings: [] };
  } catch {
    return {
      readable: false,
      plugins: [],
      findings: [{
        severity: 'error',
        rule: 'SKILL_INVALID_CLAUDE_SETTINGS',
        path: file,
        message: `${file} is not valid JSON`,
      }],
    };
  }
}

function collectStrings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item));
  if (value && typeof value === 'object') return Object.values(value).flatMap((item) => collectStrings(item));
  return [];
}

function printList(state) {
  if (state.json) {
    printJson(state);
    return;
  }
  console.log(`root=${state.root}`);
  console.log(`status=${state.status}`);
  printSkillNames('codex_skills', state.codex.skills);
  printSkillNames('claude_skills', state.claude.skills);
  console.log(`claude_plugins=${state.claude.settings.plugins.length > 0 ? state.claude.settings.plugins.join(',') : '(none)'}`);
  console.log(`pamem_runtime=${state.pamem_runtime.config.exists ? 'present' : 'missing'}`);
}

function printInspect(state) {
  if (state.json) {
    printJson(state);
    return;
  }
  printList(state);
  console.log(`codex_skills_dir=${state.codex.skills_dir}`);
  for (const skill of state.codex.skills) {
    console.log(`codex_skill ${skill.name} kind=${skill.kind} status=${skill.status}${skill.target ? ` target=${skill.target}` : ''}`);
  }
  console.log(`claude_skills_dir=${state.claude.skills_dir}`);
  for (const skill of state.claude.skills) {
    console.log(`claude_skill ${skill.name} kind=${skill.kind} status=${skill.status}${skill.target ? ` target=${skill.target}` : ''}`);
  }
  console.log(`codex_hooks_enabled=${state.pamem_runtime.codex.codex_hooks_enabled}`);
  console.log(`session_start_hook=${state.pamem_runtime.codex.session_start_hook}`);
}

function printVerify(state) {
  if (state.json) {
    printJson(state);
  } else {
    console.log(`root=${state.root}`);
    console.log(`status=${state.status}`);
    for (const finding of state.findings) {
      console.log(`${finding.severity} ${finding.rule} ${finding.path}: ${finding.message}`);
    }
  }
  if (state.status !== 'ok') process.exit(1);
}

function printChange(result) {
  if (result.json) {
    printJson(result);
    return;
  }
  console.log(`root=${result.root}`);
  console.log(`action=${result.action}`);
  console.log(`skill=${result.skill.name}`);
  if (result.skill.source) console.log(`source=${result.skill.source}`);
  console.log(`codex=${result.codex.action} ${result.codex.path}`);
  console.log(`claude=${result.claude.action} ${result.claude.path}`);
}

function printSkillNames(label, skills) {
  console.log(`${label}=${skills.length > 0 ? skills.map((skill) => skill.name).join(',') : '(none)'}`);
}

function printJson(value) {
  const { json: _json, ...output } = value;
  console.log(JSON.stringify(output, null, 2));
}

function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return '';
  }
}

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function isDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}
