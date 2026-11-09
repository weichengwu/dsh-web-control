/**
 * Resolution of the executable that runs `dsh web …` (kept separate from process.ts so it
 * can be unit-tested without side effects).
 *
 * cli.js lives inside app.asar, which a plain `node` process cannot read, so the wrapper
 * `/usr/local/bin/dsh` (ELECTRON_RUN_AS_NODE + --expose-internals) is the right entry point.
 */
import { constants, accessSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { DshWebControlError } from './types.ts';

/** The asar-internal CLI, used only by the last-resort Electron fallback. */
const ASAR_CLI = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js';
const ELECTRON_BIN = '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness';

export interface DshCommand {
  command: string;
  /** Arguments placed before the `web …` arguments. */
  prefixArgs: string[];
  /** Extra environment for the child (e.g. ELECTRON_RUN_AS_NODE). */
  env: Record<string, string>;
  /** How it was found, for error messages. */
  source: 'env' | 'path' | 'default-path' | 'electron-fallback';
}

function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function realFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Order: DSH_WEB_CONTROL_BIN, `dsh` on PATH, /usr/local/bin/dsh, then the Electron binary
 * with --expose-internals pointing at the asar CLI.
 */
export function resolveDshCommand(): DshCommand {
  const override = process.env.DSH_WEB_CONTROL_BIN;
  if (typeof override === 'string' && override.trim() !== '') {
    const path = override.trim();
    if (isExecutable(path)) return { command: path, prefixArgs: [], env: {}, source: 'env' };
    throw new DshWebControlError('cli_not_found', `DSH_WEB_CONTROL_BIN 指向的可执行文件不存在或不可执行：${path}`, 503);
  }
  const names = process.platform === 'win32' ? ['dsh.cmd', 'dsh.exe', 'dsh'] : ['dsh'];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (isExecutable(candidate)) return { command: candidate, prefixArgs: [], env: {}, source: 'path' };
    }
  }
  if (isExecutable('/usr/local/bin/dsh')) return { command: '/usr/local/bin/dsh', prefixArgs: [], env: {}, source: 'default-path' };
  if (isExecutable(ELECTRON_BIN) && realFile(ASAR_CLI)) {
    return { command: ELECTRON_BIN, prefixArgs: ['--expose-internals', ASAR_CLI], env: { ELECTRON_RUN_AS_NODE: '1' }, source: 'electron-fallback' };
  }
  throw new DshWebControlError(
    'cli_not_found',
    '找不到 dsh 可执行文件。请在 PATH 中放入 dsh（例如 /usr/local/bin/dsh），或用环境变量 DSH_WEB_CONTROL_BIN 指定它的绝对路径。',
    503,
  );
}

/** Child env: keep the user's environment, force HOME, and keep loopback probes off the system proxy. */
export function childEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, HOME: homedir() };
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'];
  for (const key of ['NO_PROXY', 'no_proxy']) {
    const current = typeof env[key] === 'string' ? env[key]!.split(',').map(part => part.trim()).filter(part => part !== '') : [];
    env[key] = [...current, ...loopback.filter(host => !current.includes(host))].join(',');
  }
  return env;
}
