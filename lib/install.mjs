import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { configPath, defaultProfile, memoryRepoGitAuthor, memoryRepoRoot, memoryRepoSyncRemote, runtimeMode } from './config.mjs';

const roles = {
  onboarding: {
    title: 'Onboarding',
    workflow: 'onboarding workflow',
    experience: 'onboarding findings, corrections, and workflow lessons',
  },
  coder: {
    title: 'Coder',
    workflow: 'implementation workflow',
    experience: 'implementation findings, corrections, and workflow lessons',
  },
  reviewer: {
    title: 'Reviewer',
    workflow: 'review workflow',
    experience: 'review findings, corrections, and risk-analysis lessons',
  },
  researcher: {
    title: 'Researcher',
    workflow: 'research, source capture, and knowledge curation workflow',
    experience: 'research findings, source curation, retrieval, and handoff lessons',
  },
};

export function installPamem(args, context) {
  const { workspace, rest } = workspaceArgs(args, context.defaultWorkspace);
  const agentHomeMode = parseInstallMode(rest);

  const paths = installPaths(workspace, agentHomeMode, context);
  mkdirSync(paths.codexDir, { recursive: true });

  if (!agentHomeMode) {
    ensureRuntimeLink(join(context.repoRoot, 'scripts'), paths.foundationScriptsDir);
    ensureRuntimeLink(context.assetsDir, paths.foundationAssetsDir);
  }
  ensureCodexSkillLinks(context.repoRoot, paths.codexSkillsDir);

  copyIfMissing(join(context.assetsDir, 'config.toml.template'), paths.configPath);

  const mode = runtimeMode(workspace);
  const profile = defaultProfile(workspace);
  const repoRoot = memoryRepoRoot(workspace);
  const memoryRepoWasInitialized = !existsSync(join(repoRoot, '.git'));
  ensureMemoryRepoSkeleton(repoRoot, context.assetsDir, profile);
  ensureMemoryRepoGit(repoRoot);
  ensureMemoryRepoGitAuthor(repoRoot, workspace);

  if (!agentHomeMode) {
    if (mode === 'cli') {
      mkdirSync(join(paths.notesDir, 'projects'), { recursive: true });
      copyIfMissing(join(context.assetsDir, 'notes', 'user-preferences.md.template'), join(paths.notesDir, 'user-preferences.md'));
      copyLegacyOrTemplateIfMissing(
        join(paths.notesDir, 'agent-workflow.md'),
        join(context.assetsDir, 'notes', 'operating-rules.md.template'),
        join(paths.notesDir, 'operating-rules.md'),
      );
      renderTemplateToFileIfMissing(join(paths.notesDir, 'experience.md'), join(context.assetsDir, 'notes', 'experience.md.template'), profile);
      if (!nonEmptyFile(paths.memoryPath)) {
        writeFileSync(paths.memoryPath, renderRoleTemplate(readFileSync(join(context.assetsDir, 'MEMORY.md.template'), 'utf8'), profile));
      } else {
        repairRoleTemplateReferences(paths.memoryPath, profile);
      }
      ensureInsertAfterTitle(paths.memoryPath, '## Memory Governance', join(context.assetsDir, 'memory-governance.md.fragment'));
    } else if (mode === 'slock') {
      ensureSlockWorkspaceMemory(paths.memoryPath, context.assetsDir);
    }
  }

  if (mode === 'cli' || mode === 'slock') {
    copyIfMissing(join(context.assetsDir, 'notes', 'current-task.md.template'), paths.currentTaskPath);
    copyIfMissing(join(context.assetsDir, 'notes', 'work-log.md.template'), paths.workLogPath);
  }

  ensureCodexConfig(join(paths.codexDir, 'config.toml'));
  mergeCodexHooks(join(paths.codexDir, 'hooks.json'), paths.sessionCmd);

  console.log(`Installed Codex pamem bootstrap into ${workspace}`);
  if (memoryRepoWasInitialized) {
    printMemoryRepoInitReminder(repoRoot, workspace);
  }
}

export function repairPamem(args, context) {
  installPamem(args, context);
}

export function removePamem(args, context) {
  const { workspace, rest } = workspaceArgs(args, context.defaultWorkspace, { create: false });
  if (rest.length > 0) {
    failUsage('Usage: pamem remove [workspace]');
  }

  const codexHooks = join(workspace, '.codex', 'hooks.json');
  const codexSkillsDir = join(workspace, '.codex', 'skills');
  removeCodexHook(codexHooks, '.pamem/scripts/memory-session-start.sh');
  removeCodexHook(codexHooks, join(context.scriptsDir, 'memory-session-start.sh'));
  removeCodexSkillLinks(context.repoRoot, codexSkillsDir);

  console.log(`Removed Codex pamem hook entries from ${workspace}`);
}

function workspaceArgs(args, defaultRoot, options = {}) {
  const create = options.create ?? true;
  const rest = [...args];
  let workspace = '.';
  if (rest.length > 0) {
    workspace = rest.shift();
  } else {
    workspace = defaultRoot || '.';
  }

  if (create) {
    mkdirSync(workspace, { recursive: true });
  }
  return {
    workspace: realpathSync(workspace),
    rest,
  };
}

function parseInstallMode(args) {
  if (args.length > 1) {
    failUsage('Usage: pamem install [workspace] [--agent-home]');
  }
  if (args.length === 0) return false;
  if (args[0] === '--agent-home') return true;
  failUsage(`unknown argument: ${args[0]}`);
}

function installPaths(workspace, agentHomeMode, context) {
  if (agentHomeMode) {
    return {
      codexDir: join(workspace, '.codex'),
      codexSkillsDir: join(workspace, '.codex', 'skills'),
      configPath: join(workspace, 'config.toml'),
      currentTaskPath: join(workspace, 'current-task.md'),
      workLogPath: join(workspace, 'work-log.md'),
      sessionCmd: join(context.scriptsDir, 'memory-session-start.sh'),
    };
  }

  const foundationDir = join(workspace, '.pamem');
  const notesDir = join(workspace, 'notes');
  mkdirSync(notesDir, { recursive: true });
  mkdirSync(foundationDir, { recursive: true });

  return {
    notesDir,
    codexDir: join(workspace, '.codex'),
    codexSkillsDir: join(workspace, '.codex', 'skills'),
    foundationScriptsDir: join(foundationDir, 'scripts'),
    foundationAssetsDir: join(foundationDir, 'assets'),
    configPath: join(foundationDir, 'config.toml'),
    memoryPath: join(workspace, 'MEMORY.md'),
    currentTaskPath: join(notesDir, 'current-task.md'),
    workLogPath: join(notesDir, 'work-log.md'),
    sessionCmd: '.pamem/scripts/memory-session-start.sh',
  };
}

function nonEmptyFile(path) {
  try {
    return lstatSync(path).size > 0;
  } catch {
    return false;
  }
}

function copyIfMissing(src, dst) {
  if (nonEmptyFile(dst)) return;
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst);
}

function copyLegacyOrTemplateIfMissing(legacy, src, dst) {
  if (nonEmptyFile(dst)) return;
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(nonEmptyFile(legacy) ? legacy : src, dst);
}

function relativeLinkTarget(src, dst) {
  return relative(dirname(dst), src) || '.';
}

function ensureRuntimeLink(src, dst) {
  const relSrc = relativeLinkTarget(src, dst);
  mkdirSync(dirname(dst), { recursive: true });
  if (isSymlinkTo(dst, relSrc)) return;
  rmSync(dst, { recursive: true, force: true });
  symlinkSync(relSrc, dst);
}

function ensureSkillLink(src, dst) {
  const relSrc = relativeLinkTarget(src, dst);
  mkdirSync(dirname(dst), { recursive: true });
  if (isSymlinkTo(dst, relSrc)) return;
  if (existsSync(dst) && !isSymlink(dst)) {
    console.error(`pamem managed runtime skill link exists and is not a symlink: ${dst}`);
    console.error('remove or rename it, then rerun pamem install/repair');
    process.exit(1);
  }
  rmSync(dst, { force: true });
  symlinkSync(relSrc, dst);
}

function ensureCodexSkillLinks(repoRoot, codexSkillsDir) {
  const skillsDir = join(repoRoot, 'skills');
  if (!existsSync(skillsDir)) return;
  mkdirSync(codexSkillsDir, { recursive: true });
  removeRetiredSkillLink(join(codexSkillsDir, 'sync-request'), repoRoot);
  for (const skillName of readdirNames(skillsDir)) {
    const src = join(skillsDir, skillName);
    if (!isDirectory(src)) continue;
    if (!existsSync(join(src, 'SKILL.md'))) continue;
    ensureSkillLink(src, join(codexSkillsDir, skillName));
  }
}

function ensureSlockWorkspaceMemory(file, assetsDir) {
  const template = renderRoleTemplate(readFileSync(join(assetsDir, 'slock', 'MEMORY.md.template'), 'utf8'), defaultProfile(dirname(file)));

  if (nonEmptyFile(file)) {
    repairRoleTemplateReferences(file, defaultProfile(dirname(file)));
    ensureSlockMemoryRouting(file, template);
    return;
  }

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, template);
}

function ensureSlockMemoryRouting(file, template) {
  const existing = readFileSync(file, 'utf8');
  if (existing.split(/\r?\n/).includes('## Memory Routing')) return;

  const block = extractSlockMemoryRouting(template);
  const lines = existing.split(/\r?\n/);
  const insertAt = lines.length > 0 && /^#\s+/.test(lines[0]) ? 1 : 0;
  const output = [
    ...lines.slice(0, insertAt),
    '',
    block,
    ...lines.slice(insertAt),
  ].join('\n').replace(/\n{3,}/g, '\n\n');
  writeFileSync(file, output.endsWith('\n') ? output : `${output}\n`);
}

function extractSlockMemoryRouting(template) {
  const lines = template.split(/\r?\n/);
  const start = lines.findIndex((line) => line === 'This Slock workspace keeps runtime-local task state only.');
  const end = lines.findIndex((line) => line === '## Active Context');
  if (start < 0 || end < 0 || end <= start) {
    return [
      'This Slock workspace keeps runtime-local task state only.',
      'Durable memory is loaded from the configured pamem shared memory repo.',
      '',
      '## Memory Routing',
      '- `.pamem/config.toml` selects the active profile and shared memory repo.',
      '- The durable startup memory index lives in the shared repo `MEMORY.md`.',
    ].join('\n');
  }
  return lines.slice(start, end).join('\n').trimEnd();
}

function ensureInsertAfterTitle(file, heading, blockFile) {
  const existing = readFileSync(file, 'utf8');
  if (existing.split(/\r?\n/).includes(heading)) return;
  const block = readFileSync(blockFile, 'utf8').trimEnd();
  const lines = existing.split(/\r?\n/);
  const output = [lines[0], '', block, ...lines.slice(1)].join('\n');
  writeFileSync(file, output);
}

function ensureMemoryRepoSkeleton(repoRoot, assetsDir, profile) {
  for (const dir of ['governance', 'shared', 'roles', 'projects', 'archive']) {
    mkdirSync(join(repoRoot, dir), { recursive: true });
  }

  renderTemplateToFileIfMissing(join(repoRoot, 'MEMORY.md'), join(assetsDir, 'MEMORY.md.template'), profile);
  repairRoleTemplateReferences(join(repoRoot, 'MEMORY.md'), profile);
  copyIfMissing(join(assetsDir, 'memory', 'governance', 'constitution.md.template'), join(repoRoot, 'governance', 'constitution.md'));
  copyIfMissing(join(assetsDir, 'notes', 'user-preferences.md.template'), join(repoRoot, 'shared', 'preferences.md'));
  copyIfMissing(join(assetsDir, 'notes', 'operating-rules.md.template'), join(repoRoot, 'shared', 'operating-rules.md'));
  copyIfMissing(join(assetsDir, 'memory', 'shared', 'experience.md.template'), join(repoRoot, 'shared', 'experience.md'));

  const roleTemplate = readFileSync(join(assetsDir, 'memory', 'roles', 'base', 'base.md.template'), 'utf8');
  for (const [role, meta] of Object.entries(roles)) {
    const roleDir = join(repoRoot, 'roles', role);
    mkdirSync(roleDir, { recursive: true });
    renderToFileIfMissing(
      join(roleDir, `${role}.md`),
      roleTemplate
        .replaceAll('{{ROLE_NAME}}', role)
        .replaceAll('{{ROLE_TITLE}}', meta.title)
        .replaceAll('{{ROLE_WORKFLOW}}', meta.workflow)
        .replaceAll('{{ROLE_EXPERIENCE}}', meta.experience),
    );
    renderToFileIfMissing(
      join(roleDir, 'experience.md'),
      `# ${meta.title} Experience\n\nDurable role-specific ${meta.experience}.\n\n- No role-specific ${role} experience recorded yet.\n`,
    );
  }
}

function renderToFileIfMissing(file, content) {
  if (nonEmptyFile(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function renderTemplateToFileIfMissing(file, templateFile, role) {
  renderToFileIfMissing(file, renderRoleTemplate(readFileSync(templateFile, 'utf8'), role));
}

function renderRoleTemplate(content, role) {
  return content.replaceAll('{{ROLE_NAME}}', role);
}

function repairRoleTemplateReferences(file, role) {
  if (!nonEmptyFile(file)) return;
  const original = readFileSync(file, 'utf8');
  const repaired = renderRoleTemplate(original, role)
    .replaceAll('roles/<role>/<role>.md', `roles/${role}/${role}.md`)
    .replaceAll('roles/<role>/experience.md', `roles/${role}/experience.md`);
  if (repaired !== original) writeFileSync(file, repaired);
}

function ensureMemoryRepoGit(repoRoot) {
  if (existsSync(join(repoRoot, '.git'))) return;
  const result = spawnSync('git', ['init', '-b', 'main', repoRoot], { stdio: 'ignore' });
  if (!result.error && result.status === 0) return;
  if (result.error && result.error.code === 'ENOENT') {
    console.error('pamem install requires git to initialize the shared memory repo.');
    process.exit(1);
  }
  const fallback = spawnSync('git', ['-C', repoRoot, 'init'], { stdio: 'ignore' });
  if (fallback.error) {
    console.error(fallback.error.message);
    process.exit(1);
  }
  if (fallback.status !== 0) process.exit(fallback.status ?? 1);
  spawnSync('git', ['-C', repoRoot, 'symbolic-ref', 'HEAD', 'refs/heads/main'], { stdio: 'ignore' });
}

function ensureMemoryRepoGitAuthor(repoRoot, workspace) {
  const author = memoryRepoGitAuthor(workspace);
  if (!author.name && !author.email) return;
  if (!author.name || !author.email) {
    console.error('memory_repo.git author_name and author_email must be configured together');
    process.exit(1);
  }
  runGitConfig(repoRoot, 'user.name', author.name);
  runGitConfig(repoRoot, 'user.email', author.email);
}

function runGitConfig(repoRoot, key, value) {
  const result = spawnSync('git', ['-C', repoRoot, 'config', '--local', key, value], { stdio: 'ignore' });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      console.error('pamem install requires git to apply memory_repo.git author config.');
    } else {
      console.error(result.error.message);
    }
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function printMemoryRepoInitReminder(repoRoot, workspace) {
  const remote = memoryRepoSyncRemote(workspace);
  const author = memoryRepoGitAuthor(workspace);
  const needsRemote = !remote;
  const needsAuthor = !author.name && !author.email;
  if (!needsRemote && !needsAuthor) return;

  console.log(`Shared memory repo initialized at ${repoRoot}`);
  console.log('Next: configure shared memory git settings before syncing:');
  if (needsRemote) {
    console.log('  - Provide a remote URL with --sync-remote <git-url> or set [memory_repo.sync].remote.');
  }
  if (needsAuthor) {
    console.log('  - Provide git author config with --git-author-name <name> --git-author-email <email> or set [memory_repo.git].author_name/author_email.');
  }
  console.log('Then rerun pamem setup, repair, or onboard so pamem can apply the config.');
}

function ensureCodexConfig(file) {
  if (!nonEmptyFile(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '[features]\nhooks = true\n');
    return;
  }

  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  if (lines.some((line) => /^[ \t]*codex_hooks[ \t]*=/.test(line))) {
    let hasHooks = false;
    const output = lines
      .map((line) => {
        if (/^[ \t]*hooks[ \t]*=/.test(line)) {
          hasHooks = true;
          return 'hooks = true';
        }
        if (/^[ \t]*codex_hooks[ \t]*=/.test(line)) {
          return '';
        }
        return line;
      })
      .filter((line, index, array) => !(line === '' && array[index - 1] === ''))
      .join('\n');
    if (hasHooks) {
      writeFileSync(file, output);
      return;
    }
    writeFileSync(file, insertFeatureValue(output, 'hooks = true'));
    return;
  }

  const featuresIndex = lines.findIndex((line) => line === '[features]');
  if (lines.some((line) => /^[ \t]*hooks[ \t]*=/.test(line))) {
    writeFileSync(file, lines.map((line) => (/^[ \t]*hooks[ \t]*=/.test(line) ? 'hooks = true' : line)).join('\n'));
    return;
  }
  if (featuresIndex >= 0) {
    lines.splice(featuresIndex + 1, 0, 'hooks = true');
    writeFileSync(file, lines.join('\n'));
    return;
  }

  writeFileSync(file, `${readFileSync(file, 'utf8').replace(/\s*$/, '')}\n\n[features]\nhooks = true\n`);
}

function insertFeatureValue(content, line) {
  const lines = content.split(/\r?\n/);
  const featuresIndex = lines.findIndex((candidate) => candidate === '[features]');
  if (featuresIndex >= 0) {
    lines.splice(featuresIndex + 1, 0, line);
    return lines.join('\n');
  }
  return `${content.replace(/\s*$/, '')}\n\n[features]\n${line}\n`;
}

function readJsonObject(file) {
  if (!nonEmptyFile(file)) return {};
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${file} must contain a JSON object`);
  }
  return parsed;
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function mergeCodexHooks(file, sessionCmd) {
  const data = readJsonObject(file);
  data.hooks = objectOrEmpty(data.hooks);
  const event = Array.isArray(data.hooks.SessionStart) ? data.hooks.SessionStart : [];
  const hook = { type: 'command', command: sessionCmd, statusMessage: 'Loading memory index' };
  const existing = event.find((entry) => entry && entry.matcher === 'startup|resume');
  if (existing) {
    existing.hooks = Array.isArray(existing.hooks) ? existing.hooks : [];
    if (!existing.hooks.some((item) => item && item.command === hook.command)) {
      existing.hooks.push(hook);
    }
  } else {
    event.push({ matcher: 'startup|resume', hooks: [hook] });
  }
  data.hooks.SessionStart = event;
  writeJson(file, data);
}

function removeCodexHook(file, sessionCmd) {
  if (!nonEmptyFile(file)) return;
  const data = readJsonObject(file);
  data.hooks = objectOrEmpty(data.hooks);
  const event = Array.isArray(data.hooks.SessionStart) ? data.hooks.SessionStart : [];
  data.hooks.SessionStart = event
    .map((entry) => {
      if (!entry || entry.matcher !== 'startup|resume') return entry;
      return {
        ...entry,
        hooks: (Array.isArray(entry.hooks) ? entry.hooks : []).filter((hook) => hook && hook.command !== sessionCmd),
      };
    })
    .filter((entry) => (Array.isArray(entry?.hooks) ? entry.hooks.length > 0 : true));
  writeJson(file, data);
}

function objectOrEmpty(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  return value;
}

function removeCodexSkillLinks(repoRoot, codexSkillsDir) {
  const skillsDir = join(repoRoot, 'skills');
  if (!existsSync(codexSkillsDir)) return;
  removeRetiredSkillLink(join(codexSkillsDir, 'sync-request'), repoRoot);
  if (!existsSync(skillsDir)) return;
  const skillsRoot = realpathSync(skillsDir);
  for (const skillName of readdirNames(skillsDir)) {
    const link = join(codexSkillsDir, skillName);
    if (!isSymlink(link)) continue;
    const target = resolve(dirname(link), readlinkSync(link));
    let resolvedTarget = '';
    try {
      resolvedTarget = realpathSync(target);
    } catch {
      continue;
    }
    if (resolvedTarget === join(skillsRoot, skillName)) {
      rmSync(link, { force: true });
    }
  }
}

function removeRetiredSkillLink(link, repoRoot) {
  if (!isSymlink(link)) return;
  const target = resolve(dirname(link), readlinkSync(link));
  const relativeTarget = relative(repoRoot, target);
  if (relativeTarget === 'skills/sync-request' || relativeTarget.startsWith('skills/sync-request/')) {
    rmSync(link, { force: true });
  }
}

function isSymlinkTo(path, target) {
  return isSymlink(path) && readlinkSync(path) === target;
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

function readdirNames(dir) {
  return existsSync(dir) ? readdirSync(dir) : [];
}

function failUsage(message) {
  console.error(message);
  process.exit(2);
}
