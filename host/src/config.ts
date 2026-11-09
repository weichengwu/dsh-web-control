/**
 * Persistent configuration for dsh-web-control.
 *
 * Everything lives under ~/.dsh-web-control/ (CONTRACT.md, "状态目录"):
 *   config.json   — user settings (this module)
 *   instance.json — running instance state (process.ts)
 *   dshweb.log    — child stdout + stderr (process.ts)
 *   url.txt       — current full URL, mode 600 (process.ts)
 */
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, DshWebControlError } from './types.ts';
import type { Config } from './types.ts';

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** True only for a dotted-quad IPv4 literal (no port, no CIDR, no hostname, no IPv6). */
export function isIPv4Literal(value: unknown): value is string {
  return typeof value === 'string' && IPV4.test(value.trim()) && value.trim() === value;
}

/** True for 127.0.0.0/8. */
export function isLoopbackAddress(value: string): boolean {
  return isIPv4Literal(value) && value.startsWith('127.');
}

/** Absolute path of the plugin state directory. */
export function stateDir(): string {
  return join(homedir(), '.dsh-web-control');
}

export function configPath(): string {
  return join(stateDir(), 'config.json');
}

export function instancePath(): string {
  return join(stateDir(), 'instance.json');
}

export function logPath(): string {
  return join(stateDir(), 'dshweb.log');
}

export function urlPath(): string {
  return join(stateDir(), 'url.txt');
}

/** Creates ~/.dsh-web-control with owner-only permissions. */
export async function ensureStateDir(): Promise<string> {
  const dir = stateDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Blocking variant, usable from plugin startup before the first await. */
export function ensureStateDirSync(): string {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * Validates and normalises one user-supplied config field.
 * Throws DshWebControlError('invalid_config', …) with a message the UI can show verbatim.
 */
export function normalizeConfigValue(key: keyof Config, value: unknown): Config[keyof Config] {
  switch (key) {
    case 'bindHost': {
      if (value === null || value === undefined || value === '') return null;
      if (typeof value !== 'string') {
        throw new DshWebControlError('invalid_config', 'bindHost 必须是 IPv4 字面量，例如 192.168.1.100 或 100.64.0.10', 400);
      }
      const trimmed = value.trim();
      if (!isIPv4Literal(trimmed)) {
        throw new DshWebControlError(
          'invalid_config',
          `bindHost 必须是具体 IPv4 字面量（dsh 拒绝 0.0.0.0 通配地址），收到：${JSON.stringify(value)}`,
          400,
        );
      }
      if (trimmed === '0.0.0.0') {
        throw new DshWebControlError('invalid_config', 'dsh 不接受 0.0.0.0，请选择一个具体地址（Tailscale / 局域网 / 127.0.0.1）', 400);
      }
      return trimmed;
    }
    case 'port': {
      const port = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof port !== 'number' || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
        throw new DshWebControlError('invalid_config', `port 必须是 1-65535 之间的整数，收到：${String(value)}`, 400);
      }
      return port;
    }
    case 'autoStart': {
      if (typeof value !== 'boolean') {
        throw new DshWebControlError('invalid_config', `autoStart 必须是布尔值，收到：${JSON.stringify(value)}`, 400);
      }
      return value;
    }
    default:
      throw new DshWebControlError('invalid_config', `未知配置项：${String(key)}`, 400);
  }
}

const CONFIG_KEYS = ['bindHost', 'port', 'autoStart'] as const;

/** Rejects unknown keys and returns a fully-populated, validated Config. */
export function validateConfig(input: unknown): Config {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new DshWebControlError('invalid_config', '配置必须是 JSON 对象', 400);
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
      throw new DshWebControlError('invalid_config', `未知配置项：${key}（允许 bindHost / port / autoStart）`, 400);
    }
  }
  const config: Config = { ...DEFAULT_CONFIG };
  if ('bindHost' in record) config.bindHost = normalizeConfigValue('bindHost', record.bindHost) as string | null;
  if ('port' in record) config.port = normalizeConfigValue('port', record.port) as number;
  if ('autoStart' in record) config.autoStart = normalizeConfigValue('autoStart', record.autoStart) as boolean;
  return config;
}

/**
 * Reads the persisted config; a missing or unreadable file yields the defaults
 * (a corrupt file must not lock the user out of the settings page).
 */
export async function loadConfig(): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(configPath(), 'utf8');
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  try {
    return validateConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Blocking read used at plugin startup. */
export function loadConfigSync(): Config {
  let raw: string;
  try {
    raw = readFileSync(configPath(), 'utf8');
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  try {
    return validateConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Atomic write: temp file in the same directory, then rename. Mode 600. */
export async function saveConfig(config: Config): Promise<Config> {
  const validated = validateConfig(config);
  const dir = await ensureStateDir();
  const target = join(dir, 'config.json');
  const temp = join(dir, `.config.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, target);
  await chmod(target, 0o600);
  return validated;
}

/** Merges a partial patch into the stored config, validating only the supplied keys. */
export async function patchConfig(patch: unknown): Promise<Config> {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new DshWebControlError('invalid_config', '配置补丁必须是 JSON 对象', 400);
  }
  const record = patch as Record<string, unknown>;
  const current = await loadConfig();
  const next: Config = { ...current };
  for (const key of Object.keys(record)) {
    if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
      throw new DshWebControlError('invalid_config', `未知配置项：${key}（允许 bindHost / port / autoStart）`, 400);
    }
    const k = key as keyof Config;
    const value = normalizeConfigValue(k, record[key]);
    if (k === 'bindHost') next.bindHost = value as string | null;
    else if (k === 'port') next.port = value as number;
    else next.autoStart = value as boolean;
  }
  return saveConfig(next);
}

/** Sync atomic write, for callers that cannot await (none today, kept for symmetry/testing). */
export function saveConfigSync(config: Config): Config {
  const validated = validateConfig(config);
  const dir = ensureStateDirSync();
  const target = join(dir, 'config.json');
  const temp = join(dir, `.config.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(temp, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  // rename(2) is atomic on the same filesystem.
  renameSync(temp, target);
  chmodSync(target, 0o600);
  return validated;
}
