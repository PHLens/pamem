import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { runCapture } from './process.mjs';

export const supportedRoles = ['onboarding', 'coder', 'reviewer', 'researcher'];

export function isReadableFile(path) {
  return existsSync(path);
}

export function configPath(root) {
  const agentConfig = join(root, 'config.toml');
  if (isReadableFile(agentConfig)) return agentConfig;
  return join(root, '.pamem', 'config.toml');
}

export function hasConfig(root) {
  return isReadableFile(configPath(root));
}

export function tomlValue(file, section, key) {
  if (!isReadableFile(file)) return '';
  const sectionHeader = `[${section}]`;
  let inSection = section === '';
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.replace(/[ \t]*#.*/, '').trim();
    if (!line) continue;
    if (/^\[[^\]]+\]$/.test(line)) {
      inSection = line === sectionHeader;
      continue;
    }
    if (!inSection) continue;
    const match = line.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(.*)$`));
    if (!match) continue;
    let value = match[1].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return '';
}

export function tomlArrayValues(file, section, key) {
  if (!isReadableFile(file)) return [];
  const sectionHeader = `[${section}]`;
  const values = [];
  let inSection = section === '';
  let inArray = false;

  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.replace(/[ \t]*#.*/, '').trim();
    if (!line) continue;
    if (/^\[[^\]]+\]$/.test(line)) {
      inSection = line === sectionHeader;
      inArray = false;
      continue;
    }
    if (!inSection) continue;

    if (inArray) {
      values.push(...quotedStrings(line));
      if (line.includes(']')) inArray = false;
      continue;
    }

    const match = line.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(.*)$`));
    if (!match) continue;
    const value = match[1].trim();
    values.push(...quotedStrings(value));
    if (value.includes('[') && !value.includes(']')) inArray = true;
  }

  return values;
}

function quotedStrings(value) {
  const values = [];
  const pattern = /"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    values.push(match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  }
  return values;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function configValue(root, section, key, defaultValue) {
  const value = tomlValue(configPath(root), section, key);
  return value || defaultValue;
}

export function dataHome() {
  return process.env.XDG_DATA_HOME || join(process.env.HOME || '', '.local', 'share');
}

export function expandPath(base, raw) {
  const dataDefault = '${XDG_DATA_HOME:-$HOME/.local/share}';
  const dataPlain = '$XDG_DATA_HOME';
  const dataBraced = '${XDG_DATA_HOME}';

  if (raw === dataDefault || raw.startsWith(`${dataDefault}/`)) {
    return `${dataHome()}${raw.slice(dataDefault.length)}`;
  }
  if (raw === dataPlain || raw.startsWith(`${dataPlain}/`)) {
    return `${dataHome()}${raw.slice(dataPlain.length)}`;
  }
  if (raw === dataBraced || raw.startsWith(`${dataBraced}/`)) {
    return `${dataHome()}${raw.slice(dataBraced.length)}`;
  }
  if (raw === '~') return process.env.HOME || '';
  if (raw.startsWith('~/')) return join(process.env.HOME || '', raw.slice(2));
  if (raw.startsWith('/')) return raw;
  return resolve(base, raw);
}

export function agentHomePath(agentId) {
  return join(dataHome(), 'pamem', 'agents', agentId);
}

export function pamemAgentsDir() {
  return join(dataHome(), 'pamem', 'agents');
}

export function slockAgentsDir() {
  return process.env.PAMEM_SLOCK_AGENTS_DIR || join(process.env.HOME || '', '.slock', 'agents');
}

export function discoverConfiguredRoots() {
  const roots = [];
  const seen = new Set();
  for (const dir of [pamemAgentsDir(), slockAgentsDir()]) {
    for (const root of configuredChildren(dir)) {
      if (seen.has(root)) continue;
      seen.add(root);
      roots.push(root);
    }
  }
  return roots.sort();
}

export function findConfiguredRootByAgentId(resolvedAgentId) {
  for (const candidate of [agentHomePath(resolvedAgentId), join(slockAgentsDir(), resolvedAgentId)]) {
    const root = safeRealpath(candidate);
    if (root && hasConfig(root)) return root;
  }
  return discoverConfiguredRoots().find((root) => agentId(root) === resolvedAgentId) || '';
}

export function defaultMemoryRepoRoot(workspace) {
  return expandPath(workspace, '${XDG_DATA_HOME:-$HOME/.local/share}/pamem/memory');
}

export function memoryRepoRoot(workspace) {
  const rawPath = tomlValue(configPath(workspace), 'memory_repo', 'path');
  if (!rawPath) return defaultMemoryRepoRoot(workspace);
  return expandPath(workspace, rawPath);
}

export function memoryRepoEntryFile(root) {
  return configValue(root, 'memory_repo', 'entry_file', 'MEMORY.md');
}

export function memoryRepoSyncRemote(root) {
  return configValue(root, 'memory_repo.sync', 'remote', '');
}

export function memoryRepoGitAuthor(root) {
  return {
    name: configValue(root, 'memory_repo.git', 'author_name', ''),
    email: configValue(root, 'memory_repo.git', 'author_email', ''),
  };
}

export function defaultProfile(root) {
  return configValue(root, '', 'default_profile', 'onboarding');
}

export function runtimeMode(root) {
  return configValue(root, 'runtime', 'mode', 'cli');
}

export function agentId(root) {
  const raw = configValue(root, 'runtime', 'agent_id', '');
  if (raw) return raw;
  return `workspace-${createHash('sha256').update(root).digest('hex').slice(0, 16)}`;
}

export function isAgentHome(root) {
  return isReadableFile(join(root, 'config.toml'));
}

export function agentLocalDir(root, resolvedAgentId = '') {
  if (isAgentHome(root)) return root;
  return agentHomePath(resolvedAgentId || agentId(root));
}

export function workspaceCurrentTaskPath(root) {
  return join(root, 'notes', 'current-task.md');
}

export function workspaceWorkLogPath(root) {
  return join(root, 'notes', 'work-log.md');
}

export function installedWorkspaceRoot(pluginRoot) {
  if (basename(pluginRoot) !== '.pamem' || !isReadableFile(join(pluginRoot, 'config.toml'))) {
    return '';
  }
  const candidate = dirname(pluginRoot);
  return hasConfig(candidate) ? candidate : '';
}

export function resolveRuntimeRoot(pluginRoot) {
  if (basename(pluginRoot) !== '.pamem') return pluginRoot;
  const installed = installedWorkspaceRoot(pluginRoot);
  if (!installed) return pluginRoot;
  const scriptsLink = join(pluginRoot, 'scripts');
  const target = runCapture('readlink', [scriptsLink]);
  if (!target) return pluginRoot;
  return resolve(dirname(scriptsLink), target, '..');
}

function configuredChildren(dir) {
  if (!existsSync(dir)) return [];
  const roots = [];
  for (const name of readdirSync(dir).sort()) {
    const root = safeRealpath(join(dir, name));
    if (root && hasConfig(root)) roots.push(root);
  }
  return roots;
}

function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return '';
  }
}
