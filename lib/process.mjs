import { spawnSync } from 'node:child_process';

export function fail(message) {
  console.error(message);
  process.exit(2);
}

export function runStep(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

export function runAndExit(command, args, options = {}) {
  runStep(command, args, options);
  process.exit(0);
}

export function runCapture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    return '';
  }
  return result.stdout.trim();
}

export function runBash(script, args, options = {}) {
  runAndExit('bash', [script, ...args], options);
}
