/**
 * Lifecycle of the managed dsh web instance.
 *
 * Start:    `dsh web --no-open --port <PORT> --host <IP> --public-url http://<IP>:<PORT>/`
 * Ready:    the child prints `dsh web: http://<IP>:<PORT>/?token=<TOKEN>`, and ONLY that line
 *           is the readiness signal. It is preceded by the harmless
 *           `dsh web: listening on <IP> over plain HTTP; …` warning, so the match must be
 *           `/^dsh web: (https?:\/\/\S+)$/` — anchoring on the scheme is what skips the warning.
 * Stop:     SIGTERM to the whole process group, 15 s grace, then SIGKILL.
 *
 * The child is `detached` and `unref()`ed: DSH quitting must not kill the web instance
 * someone is currently browsing from their phone.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { chmod, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  ensureStateDir,
  instancePath,
  isIPv4Literal,
  loadConfig,
  logPath,
  normalizeConfigValue,
  urlPath,
} from './config.ts';
import { discoverCandidates, resolveBindHost } from './discover.ts';
import { childEnvironment, resolveDshCommand } from './cli.ts';
import type { Candidate, Config, InstanceState, StatusResponse } from './types.ts';
import { DEFAULT_CONFIG, DshWebControlError } from './types.ts';

/** Only this shape is a ready line; the plain-HTTP warning never matches because of the scheme group. */
export const READY_LINE = /^dsh web: (https?:\/\/\S+)$/;

const READY_TIMEOUT_MS = 45_000;
const STOP_GRACE_MS = 15_000;
const POLL_INTERVAL_MS = 200;

/** True when a whole log line is the ready line, returning its URL. */
export function parseReadyLine(line: string): string | undefined {
  const match = READY_LINE.exec(line.trim());
  return match?.[1];
}

/** Serialises lifecycle operations so two clicks cannot race a start/stop pair. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** One run of `lsof -nP -iTCP:<port> -sTCP:LISTEN`, returning the pids that hold the port. */
function portOwners(port: number): Promise<number[]> {
  return new Promise(resolve => {
    if (process.platform === 'win32') return resolve([]);
    const child = spawn('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString('utf8'); });
    child.on('error', () => resolve([]));
    child.on('close', () => {
      const pids = out.split(/\s+/).map(part => Number(part)).filter(pid => Number.isSafeInteger(pid) && pid > 0);
      resolve([...new Set(pids)]);
    });
  });
}

/** True when the process is alive and not a zombie. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function readInstance(): Promise<InstanceState & { pgid?: number }> {
  try {
    const raw = await readFile(instancePath(), 'utf8');
    const value = JSON.parse(raw) as Partial<InstanceState> & { pgid?: unknown };
    return {
      pid: typeof value.pid === 'number' ? value.pid : null,
      running: value.running === true,
      url: typeof value.url === 'string' ? value.url : null,
      bindHost: typeof value.bindHost === 'string' ? value.bindHost : null,
      port: typeof value.port === 'number' ? value.port : null,
      startedAt: typeof value.startedAt === 'number' ? value.startedAt : null,
      logFile: typeof value.logFile === 'string' ? value.logFile : logPath(),
      ...(typeof value.pgid === 'number' ? { pgid: value.pgid } : {}),
    };
  } catch {
    return emptyState();
  }
}

function emptyState(): InstanceState & { pgid?: number } {
  return { pid: null, running: false, url: null, bindHost: null, port: null, startedAt: null, logFile: logPath() };
}

async function writeInstance(state: InstanceState & { pgid?: number }, privateMode = true): Promise<void> {
  const dir = await ensureStateDir();
  const target = instancePath();
  const temp = join(dir, `.instance.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: privateMode ? 0o600 : 0o644 });
  await rename(temp, target);
  if (privateMode) await chmod(target, 0o600);
  if (typeof state.url === 'string' && state.url !== '') await writeUrlFile(state.url);
}

/** url.txt holds the token URL, owner-readable only. */
async function writeUrlFile(url: string): Promise<void> {
  const dir = await ensureStateDir();
  const target = urlPath();
  const temp = join(dir, `.url.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, `${url}\n`, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, target);
  await chmod(target, 0o600);
}

/** The live state, re-validated against the OS: a dead pid or a released port means not running. */
export async function currentState(): Promise<InstanceState & { pgid?: number }> {
  const stored = await readInstance();
  if (!stored.running) return stored;
  const alive = stored.pid !== null && isProcessAlive(stored.pid);
  const listening = stored.port !== null && (await portOwners(stored.port)).length > 0;
  if (alive && listening) return stored;
  const stale: InstanceState & { pgid?: number } = { ...stored, running: false, url: null, pid: alive ? stored.pid : null };
  await writeInstance(stale, false);
  await rm(urlPath(), { force: true });
  return stale;
}

async function statusWith(candidates: Candidate[]): Promise<StatusResponse> {
  const [state, config] = await Promise.all([currentState(), loadConfig()]);
  const { host, warnings } = await resolveBindHost(config.bindHost);
  const { pgid: _pgid, ...stateWithoutPgid } = state;
  return { ...stateWithoutPgid, candidates, effectiveHost: host, config, warnings };
}

/** GET /status. */
export async function status(): Promise<StatusResponse> {
  return serial(async () => statusWith(await discoverCandidates()));
}

/** Tail of dshweb.log, at most `lines` lines. */
export async function readLog(lines = 200): Promise<string> {
  const count = Number.isSafeInteger(lines) && lines > 0 ? Math.min(lines, 2_000) : 200;
  let raw: string;
  try {
    raw = await readFile(logPath(), 'utf8');
  } catch {
    return '';
  }
  const all = raw.split(/\r?\n/);
  // A trailing newline yields an empty last element; keep the file's shape instead of a fake blank line.
  if (all.length > 0 && all[all.length - 1] === '') all.pop();
  return all.slice(-count).join('\n');
}

/** Mutable record of how the child ended, filled in by an 'exit' listener attached early. */
export interface ExitWatch {
  readonly result: { code: number | null; signal: NodeJS.Signals | null } | undefined;
}

/**
 * Resolves once the child has actually been exec'd.
 *
 * A detached child reports `pid` synchronously on success and emits 'error' on failure, but
 * the 'spawn' event itself is not reliable here: it can be missed when the parent closes the
 * inherited log fd immediately afterwards, which would stall a start until its deadline. So
 * the settled state is derived from `pid` / 'error' and never from 'spawn' alone.
 */
function waitForSpawn(child: ChildProcess): Promise<Error | undefined> {
  return new Promise(resolve => {
    let settled = false;
    const settle = (error: Error | undefined) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      resolve(error);
    };
    const poll = setInterval(() => {
      if (child.pid !== undefined) settle(undefined);
    }, 25);
    child.once('error', error => settle(error));
    child.once('spawn', () => settle(undefined));
    // `pid` is assigned synchronously by a successful spawn; check it before any await.
    if (child.pid !== undefined) settle(undefined);
  });
}

/**
 * Arms the exit watch. Call this before `child.unref()`: a listener attached afterwards
 * can miss an exit that already happened, which turns a fast failure into a 45 s wait.
 */
function watchExitOf(child: ChildProcess): ExitWatch {
  const watch: { result?: { code: number | null; signal: NodeJS.Signals | null } } = {};
  child.once('exit', (code, signal) => { watch.result = { code, signal }; });
  return watch as ExitWatch;
}

/** Waits for the ready line in the log, or reports the tail on timeout/exit. */
async function waitForReady(watch: ExitWatch, port: number, deadline: number): Promise<string> {
  const exited = () => watch.result;
  while (Date.now() < deadline) {
    const text = await readLog(400);
    // Scan from the end so a restart's new URL wins over an older one in a long-lived log.
    const lines = text.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const url = parseReadyLine(lines[index] ?? '');
      if (url !== undefined && url.includes(`:${port}/`)) return url;
    }
    if (exited() !== undefined) {
      const tail = await readLog(40);
      const { code, signal } = exited()!;
      throw new DshWebControlError('start_failed', `dsh web 启动失败（退出码 ${String(code)}${signal ? `，信号 ${signal}` : ''}）。日志尾部：\n${tail}`, 500);
    }
    await delay(POLL_INTERVAL_MS);
  }
  const tail = await readLog(40);
  throw new DshWebControlError('start_timeout', `等待 dsh web 就绪超时（${READY_TIMEOUT_MS / 1000}s）。日志尾部：\n${tail}`, 500);
}

export interface StartOptions {
  host?: string | undefined;
  port?: number | undefined;
}

/** POST /start. Idempotent: an already-running instance is reported, not duplicated. */
export async function start(options: StartOptions = {}): Promise<StatusResponse> {
  return serial(async () => {
    const config = await loadConfig();
    const candidates = await discoverCandidates();

    let bindHost: string;
    if (options.host !== undefined) bindHost = normalizeConfigValue('bindHost', options.host) as string | null ?? '';
    else bindHost = config.bindHost ?? '';
    const resolved = await resolveBindHost(bindHost === '' ? null : bindHost);
    const host = resolved.host;
    const warnings = [...resolved.warnings];

    const port = options.port !== undefined ? (normalizeConfigValue('port', options.port) as number) : config.port;
    if (!isIPv4Literal(host)) throw new DshWebControlError('invalid_host', `无法确定绑定地址：${host}`, 400);

    const state = await currentState();
    if (state.running && state.port === port && state.bindHost === host) return statusWith(candidates);
    if (state.running) throw new DshWebControlError('already_running', `dsh web 已在 ${state.bindHost ?? '?'}:${String(state.port)} 运行，请先停止或使用重启。`, 409);

    const owners = await portOwners(port);
    if (owners.length > 0) {
      throw new DshWebControlError('port_in_use', `端口 ${port} 已被占用（PID ${owners.join(', ')}），请换一个端口。`, 409);
    }

    const command = resolveDshCommand();
    const dir = await ensureStateDir();
    const file = logPath();
    // Truncate per start: the ready line from a previous run must never be mistaken for this one.
    const out = await open(file, 'w', 0o600);
    await chmod(file, 0o600);
    const publicUrl = `http://${host}:${port}/`;
    const args = [...command.prefixArgs, 'web', '--no-open', '--port', String(port), '--host', host, '--public-url', publicUrl];
    const startedAt = Date.now();
    let child: ChildProcess;
    try {
      child = spawn(command.command, args, {
        detached: true,
        stdio: ['ignore', out.fd, out.fd],
        env: { ...childEnvironment(), ...command.env },
        cwd: homedir(),
      });
    } catch (error) {
      await out.close().catch(() => undefined);
      throw new DshWebControlError('spawn_failed', `无法启动 dsh：${(error as Error).message}`, 500);
    }
    // The fd stays open in the child; the parent's copy must not keep it alive.
    await out.close().catch(() => undefined);

    const spawnError = await waitForSpawn(child);
    if (spawnError) throw new DshWebControlError('spawn_failed', `无法启动 dsh（${command.command}）：${spawnError.message}`, 500);

    const pid = child.pid ?? null;
    if (pid === null) throw new DshWebControlError('spawn_failed', 'dsh 进程没有返回 pid。', 500);
    await writeInstance({ pid, running: false, url: null, bindHost: host, port, startedAt, logFile: file, pgid: pid }, false);

    try {
      // Arm the exit watch BEFORE unref(). A detached+unref'd child stops keeping the event
      // loop alive, and a listener attached after unref() can miss an exit that already
      // happened — the wait would then run to its full deadline instead of failing fast.
      const watchExit = watchExitOf(child);
      child.unref();
      const url = await waitForReady(watchExit, port, startedAt + READY_TIMEOUT_MS);
      const ready = await waitListening(port, Math.min(10_000, READY_TIMEOUT_MS));
      if (!ready) warnings.push(`日志已显示就绪地址，但端口 ${port} 尚未监听（可能仍在初始化）。`);
      await writeInstance({ pid, running: true, url, bindHost: host, port, startedAt, logFile: file, pgid: pid }, false);
    } catch (error) {
      await terminate(pid);
      await writeInstance(emptyState(), false);
      await rm(urlPath(), { force: true });
      throw error;
    }
    return statusWith(candidates);
  });
}

/** Polls lsof until the port is held, at most `budgetMs`. */
async function waitListening(port: number, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if ((await portOwners(port)).length > 0) return true;
    if (Date.now() >= deadline) return false;
    await delay(POLL_INTERVAL_MS * 2);
  }
}

/** SIGTERM the whole group, escalate to SIGKILL after the grace period. */
async function terminate(pid: number): Promise<boolean> {
  if (!isProcessAlive(pid)) return true;
  const group = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      try { process.kill(pid, signal); } catch { /* already gone */ }
    }
  };
  group('SIGTERM');
  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await delay(POLL_INTERVAL_MS);
  }
  group('SIGKILL');
  const killDeadline = Date.now() + 5_000;
  while (Date.now() < killDeadline) {
    if (!isProcessAlive(pid)) return true;
    await delay(POLL_INTERVAL_MS);
  }
  return !isProcessAlive(pid);
}

/** POST /stop. A no-op (success) when nothing is running. */
export async function stop(): Promise<StatusResponse> {
  return serial(async () => {
    const state = await currentState();
    if (state.running && state.pid !== null) {
      const stopped = await terminate(state.pid);
      if (!stopped) throw new DshWebControlError('stop_failed', `无法停止 dsh web（PID ${state.pid}）。`, 500);
    }
    await rm(instancePath(), { force: true });
    await rm(urlPath(), { force: true });
    return statusWith(await discoverCandidates());
  });
}

/** POST /restart. */
export async function restart(options: StartOptions = {}): Promise<StatusResponse> {
  await stop();
  return start(options);
}

/** GET /config. */
export async function configSnapshot(): Promise<{ config: Config; candidates: Candidate[] }> {
  const [config, candidates] = await Promise.all([loadConfig(), discoverCandidates()]);
  return { config, candidates };
}

export { DEFAULT_CONFIG };
export { childEnvironment, resolveDshCommand };
export type { DshCommand } from './cli.ts';
