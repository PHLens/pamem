import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { runCapture } from './process.mjs';

export const supportedRoles = ['onboarding', 'coder', 'reviewer', 'researcher', 'wiki'];

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

export function defaultMemoryRepoRoot(workspace) {
  return expandPath(workspace, '${XDG_DATA_HOME:-$HOME/.local/share}/pamem/memory');
}

export function memoryRepoRoot(workspace) {
  const rawPath = tomlValue(configPath(workspace), 'memory_repo', 'path');
  if (!rawPath) return defaultMemoryRepoRoot(workspace);
  return expandPath(workspace, rawPath);
}

export function defaultProfile(root) {
  return configValue(root, '', 'default_profile', 'onboarding');
}

export function runtimeMode(root) {
  return configValue(root, 'runtime', 'mode', 'cli');
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
