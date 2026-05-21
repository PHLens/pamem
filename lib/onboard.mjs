import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { memoryRepoRoot, supportedRoles, tomlValue } from './config.mjs';
import { installPamem } from './install.mjs';
import { fail } from './process.mjs';

export function onboardPamem(args, context, options = {}) {
  const parsed = parseOnboardArgs(args);
  const workspace = prepareWorkspace(parsed.root);
  const configFile = parsed.agentHomeMode ? join(workspace, 'config.toml') : join(workspace, '.pamem', 'config.toml');
  const templateFile = profileTemplate(parsed.profile, context.assetsDir);

  if (!existsSync(templateFile)) {
    console.error(`missing config template for profile '${parsed.profile}': ${templateFile}`);
    process.exit(1);
  }

  if (nonEmptyFile(configFile) && !parsed.force) {
    const existingProfile = tomlValue(configFile, '', 'default_profile');
    if (existingProfile) {
      console.error(`pamem config already exists with default_profile=${existingProfile}; rerun with --force only for deliberate re-onboarding`);
    } else {
      console.error('pamem config already exists; rerun with --force only for deliberate re-onboarding');
    }
    process.exit(1);
  }

  mkdirSync(dirname(configFile), { recursive: true });
  cpSync(templateFile, configFile);

  if (parsed.memoryRepo) {
    setTomlValue(configFile, 'memory_repo', 'path', tomlString(parsed.memoryRepo));
  }
  setTomlValue(configFile, 'runtime', 'mode', tomlString(parsed.runtime));
  if (parsed.agentId) {
    setTomlValue(configFile, 'runtime', 'agent_id', tomlString(parsed.agentId));
  }
  if (parsed.syncRemote) {
    setTomlValue(configFile, 'memory_repo.sync', 'remote', tomlString(parsed.syncRemote));
  }
  if (parsed.syncRef) {
    setTomlValue(configFile, 'memory_repo.sync', 'ref', tomlString(parsed.syncRef));
  }
  if (parsed.gitAuthorName) {
    setTomlValue(configFile, 'memory_repo.git', 'author_name', tomlString(parsed.gitAuthorName));
  }
  if (parsed.gitAuthorEmail) {
    setTomlValue(configFile, 'memory_repo.git', 'author_email', tomlString(parsed.gitAuthorEmail));
  }

  installPamem(parsed.agentHomeMode ? [workspace, '--agent-home'] : [workspace], context);

  if (!options.quiet) {
    if (parsed.agentHomeMode) {
      console.log(`Onboarded pamem agent home ${workspace} with profile=${parsed.profile}`);
    } else {
      console.log(`Onboarded pamem workspace ${workspace} with profile=${parsed.profile}`);
    }
    console.log(`Config: ${configFile}`);
    console.log(`Memory repo: ${memoryRepoRoot(workspace)}`);
    console.log(`Agent: ${resolvedAgentId(configFile, workspace)}`);
  }
}

export function onboardUsage() {
  console.log(`Usage: pamem onboard <workspace> [--agent-home] [--profile <onboarding|coder|reviewer|researcher>] [--runtime <cli|slock>] [--agent-id <id>] [--memory-repo <path>] [--sync-remote <target>] [--sync-ref <ref>] [--git-author-name <name>] [--git-author-email <email>] [--force]

Create the pamem config during onboarding, then seed local files.

Profile selection is an onboarding-time decision. Existing config is preserved
unless --force is passed for deliberate re-onboarding.`);
}

function parseOnboardArgs(args) {
  if (args.length < 1) {
    onboardUsage();
    process.exit(2);
  }
  if (args[0] === '-h' || args[0] === '--help') {
    onboardUsage();
    process.exit(0);
  }

  const parsed = {
    root: args[0],
    agentHomeMode: false,
    profile: 'onboarding',
    runtime: 'cli',
    agentId: '',
    memoryRepo: '',
    syncRemote: '',
    syncRef: '',
    gitAuthorName: '',
    gitAuthorEmail: '',
    force: false,
  };

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--agent-home') {
      parsed.agentHomeMode = true;
      continue;
    }
    if (arg === '--force') {
      parsed.force = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      onboardUsage();
      process.exit(0);
    }
    const parsedOption = parseValueOption(arg, args, i);
    if (parsedOption) {
      i = parsedOption.index;
      switch (parsedOption.name) {
        case '--profile':
          parsed.profile = parsedOption.value;
          break;
        case '--runtime':
          parsed.runtime = parsedOption.value;
          break;
        case '--agent-id':
          parsed.agentId = parsedOption.value;
          break;
        case '--memory-repo':
          parsed.memoryRepo = parsedOption.value;
          break;
        case '--sync-remote':
          parsed.syncRemote = parsedOption.value;
          break;
        case '--sync-ref':
          parsed.syncRef = parsedOption.value;
          break;
        case '--git-author-name':
          parsed.gitAuthorName = parsedOption.value;
          break;
        case '--git-author-email':
          parsed.gitAuthorEmail = parsedOption.value;
          break;
        default:
          break;
      }
      continue;
    }
    fail(`unknown onboard argument: ${arg}`);
  }

  if (!supportedRoles.includes(parsed.profile)) {
    fail(`unsupported profile: ${parsed.profile}`);
  }
  if (parsed.runtime !== 'cli' && parsed.runtime !== 'slock') {
    fail(`unsupported runtime mode: ${parsed.runtime}`);
  }
  if ((parsed.gitAuthorName && !parsed.gitAuthorEmail) || (!parsed.gitAuthorName && parsed.gitAuthorEmail)) {
    fail('--git-author-name and --git-author-email must be provided together');
  }

  return parsed;
}

function parseValueOption(arg, args, index) {
  const names = ['--profile', '--runtime', '--agent-id', '--memory-repo', '--sync-remote', '--sync-ref', '--git-author-name', '--git-author-email'];
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

function prepareWorkspace(input) {
  mkdirSync(input, { recursive: true });
  return realpathSync(input);
}

function profileTemplate(profile, assetsDir) {
  if (profile === 'onboarding') {
    return join(assetsDir, 'config.toml.template');
  }
  return join(assetsDir, 'config-profiles', `${profile}.toml.template`);
}

function nonEmptyFile(path) {
  try {
    return readFileSync(path, 'utf8').length > 0;
  } catch {
    return false;
  }
}

function tomlString(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function setTomlValue(file, section, key, value) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const sectionHeader = section ? `[${section}]` : '';
  const keyPattern = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=`);
  const output = [];
  let inSection = section === '';
  let sawSection = false;
  let updated = false;

  for (const line of lines) {
    if (/^\[[^\]]+\]$/.test(line.trim())) {
      if (inSection && !updated) {
        output.push(`${key} = ${value}`);
        updated = true;
      }
      inSection = section !== '' && line.trim() === sectionHeader;
      if (inSection) sawSection = true;
      output.push(line);
      continue;
    }

    if (inSection && keyPattern.test(line)) {
      output.push(`${key} = ${value}`);
      updated = true;
      continue;
    }

    output.push(line);
  }

  if (inSection && !updated) {
    output.push(`${key} = ${value}`);
    updated = true;
  }

  if (section !== '' && !sawSection) {
    if (output.at(-1) !== '') output.push('');
    output.push(sectionHeader, `${key} = ${value}`);
  }

  writeFileSync(file, output.join('\n'));
}

function resolvedAgentId(configFile, workspace) {
  const raw = tomlValue(configFile, 'runtime', 'agent_id');
  if (raw) return raw;
  return `workspace-${createHash('sha256').update(workspace).digest('hex').slice(0, 16)}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
