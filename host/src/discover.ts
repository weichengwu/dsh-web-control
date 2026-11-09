/**
 * Address discovery for the bind picker (CONTRACT.md, "关键机制").
 *
 * Tailscale, in priority order:
 *   1. DSH_WEB_TAILSCALE_IP
 *   2. `/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4` (first line)
 *   3. a 100.64.0.0/10 address on any interface (CGNAT range Tailscale uses)
 * LAN: `ipconfig getifaddr en0`, then any 192.168/16, 10/8 or 172.16/12 address.
 *
 * Detection only ever reads; a missing Tailscale install is not an error, it just
 * removes that candidate.
 */
import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { isIPv4Literal } from './config.ts';
import type { Candidate } from './types.ts';

const TAILSCALE_BINARIES = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  '/usr/bin/tailscale',
  'tailscale',
];

/** Tailscale's CGNAT block: 100.64.0.0/10. */
export const TAILSCALE_CIDR = '100.64.0.0/10';

const PRIVATE_IPV4 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

const LOOPBACK_HOST = '127.0.0.1';

/** Turns 100.64.0.0/10 into a numeric range check. */
export function isTailscaleAddress(ip: string): boolean {
  if (!isIPv4Literal(ip)) return false;
  const first = Number(ip.split('.')[0]);
  const second = Number(ip.split('.')[1]);
  return first === 100 && second >= 64 && second <= 127;
}

export function isPrivateAddress(ip: string): boolean {
  return isIPv4Literal(ip) && PRIVATE_IPV4.some(pattern => pattern.test(ip));
}

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function run(command: string, args: readonly string[], timeoutMs = 2_000): Promise<CommandResult> {
  return new Promise(resolve => {
    execFile(command, [...args], { timeout: timeoutMs, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      if (error) resolve({ ok: false, stdout: typeof stdout === 'string' ? stdout : '', stderr: typeof stderr === 'string' ? stderr : String(error.message) });
      else resolve({ ok: true, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

/** All IPv4 addresses present on local interfaces, in interface order. */
export function localIPv4Addresses(): { iface: string; address: string; internal: boolean }[] {
  const result: { iface: string; address: string; internal: boolean }[] = [];
  const interfaces = networkInterfaces();
  for (const [iface, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      const isV4 = String(entry.family) === 'IPv4';
      if (!isV4) continue;
      if (!isIPv4Literal(entry.address)) continue;
      result.push({ iface, address: entry.address, internal: entry.internal === true });
    }
  }
  return result;
}

/**
 * True when this machine really owns `ip` (or `ip` is loopback, which every
 * interface list carries on lo0). Used to reject a stale configured address
 * before handing it to dsh, which would otherwise fail to bind.
 */
export function isLocalAddress(ip: string): boolean {
  if (!isIPv4Literal(ip)) return false;
  if (ip.startsWith('127.')) return true;
  return localIPv4Addresses().some(entry => entry.address === ip);
}

function tailscaleBinary(): string | undefined {
  for (const candidate of TAILSCALE_BINARIES) {
    if (!candidate.includes('/')) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  return undefined;
}

/** Tailscale IPv4 address, or undefined when Tailscale is absent/offline. */
export async function detectTailscaleIPv4(): Promise<string | undefined> {
  const fromEnv = process.env.DSH_WEB_TAILSCALE_IP;
  if (typeof fromEnv === 'string' && isIPv4Literal(fromEnv.trim())) return fromEnv.trim();

  const binary = tailscaleBinary();
  if (binary) {
    const result = await run(binary, ['ip', '-4']);
    if (result.ok) {
      const first = result.stdout.split(/\r?\n/).map(line => line.trim()).find(line => line !== '');
      if (first !== undefined && isIPv4Literal(first)) return first;
    }
  }

  const fromInterfaces = localIPv4Addresses().find(entry => isTailscaleAddress(entry.address));
  return fromInterfaces?.address;
}

/** LAN IPv4 address: en0 first, then any RFC1918 address. */
export async function detectLanIPv4(): Promise<string | undefined> {
  const fromEnv = process.env.DSH_WEB_LAN_IP;
  if (typeof fromEnv === 'string' && isIPv4Literal(fromEnv.trim())) return fromEnv.trim();

  const en0 = await run('/usr/sbin/ipconfig', ['getifaddr', 'en0']);
  const value = en0.stdout.trim();
  if (en0.ok && isIPv4Literal(value) && !isTailscaleAddress(value)) return value;

  const entries = localIPv4Addresses();
  const preferred = entries.find(entry => entry.iface === 'en0' && isPrivateAddress(entry.address) && !isTailscaleAddress(entry.address));
  if (preferred) return preferred.address;
  const anyPrivate = entries.find(entry => PRIVATE_IPV4.some(pattern => pattern.test(entry.address)) && !entry.internal && !isTailscaleAddress(entry.address));
  return anyPrivate?.address;
}

/** True when every discovered interface is loopback (no LAN/Tailscale at all). */
export function isOffline(): boolean {
  return !localIPv4Addresses().some(entry => !entry.internal && !entry.address.startsWith('127.'));
}

/**
 * All bind candidates, most useful first: Tailscale, LAN, then loopback.
 * The loopback candidate is always present, so the picker is never empty.
 */
export async function discoverCandidates(): Promise<Candidate[]> {
  const [tailscale, lan] = await Promise.all([detectTailscaleIPv4(), detectLanIPv4()]);
  const candidates: Candidate[] = [];
  if (tailscale !== undefined) candidates.push({ label: `Tailscale（${tailscale}）`, host: tailscale, kind: 'tailscale' });
  if (lan !== undefined && lan !== tailscale) candidates.push({ label: `局域网（${lan}）`, host: lan, kind: 'lan' });
  candidates.push({ label: '仅本机（127.0.0.1）', host: LOOPBACK_HOST, kind: 'loopback' });
  return candidates;
}

/**
 * The address to bind when config.bindHost is null: Tailscale > LAN > loopback,
 * mirroring the candidate order. Returns a warning when a stale configured
 * address had to be dropped, so the caller can surface it instead of failing silently.
 */
export async function resolveBindHost(configured: string | null): Promise<{ host: string; warnings: string[] }> {
  const warnings: string[] = [];
  if (configured !== null) {
    if (isLocalAddress(configured)) return { host: configured, warnings };
    warnings.push(`配置的地址 ${configured} 不在本机网卡上（Tailscale 可能已断开），已改用自动探测地址。`);
    const candidates = await discoverCandidates();
    const fallback = candidates[0]?.host ?? LOOPBACK_HOST;
    return { host: fallback, warnings };
  }
  const candidates = await discoverCandidates();
  if (isOffline()) warnings.push(`未检测到局域网或 Tailscale 地址，只能绑定 ${LOOPBACK_HOST}，外部设备将无法访问。`);
  else if (candidates[0]?.kind === 'loopback') warnings.push(`未检测到局域网或 Tailscale 地址，只能绑定 ${LOOPBACK_HOST}，外部设备将无法访问。`);
  return { host: candidates[0]?.host ?? LOOPBACK_HOST, warnings };
}
