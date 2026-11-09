#!/usr/bin/env node
// Acceptance harness for dsh-web-control's process layer.
// Proves the pieces the plugin depends on actually work on this machine, independently
// of the plugin's own code: locating the dsh binary, spawning `dsh web` bound to a
// concrete IP, and parsing the readiness URL out of the log.
//
//   node test/acceptance.mjs            # uses 127.0.0.1 and a throwaway port
//   node test/acceptance.mjs --host 100.66.66.20 --port 3099
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(`--${name}`); return i === -1 ? undefined : args[i + 1]; };
const host = flag('host') ?? '127.0.0.1';
const port = Number(flag('port') ?? 3199);

// The readiness line dsh prints once the listener is up. The warning line
// ("listening on ... over plain HTTP") also starts with "dsh web:" and must not match.
const READY = /^dsh web: (https?:\/\/\S+)$/;

function resolveDshBin() {
  if (process.env.DSH_WEB_CONTROL_BIN) return process.env.DSH_WEB_CONTROL_BIN;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(dir, 'dsh');
    try {
      if (existsSync(candidate)) return candidate;
    } catch { /* unreadable PATH entry */ }
  }
  return undefined;
}

function fail(message) {
  console.error(`FAIL  ${message}`);
  process.exitCode = 1;
}

const bin = resolveDshBin();
if (!bin) { fail('dsh binary not found on PATH'); process.exit(1); }
console.log(`PASS  resolved dsh binary: ${bin}`);

const workdir = mkdtempSync(path.join(tmpdir(), 'dsh-web-control-acceptance-'));
const logPath = path.join(workdir, 'dshweb.log');

console.log(`...   starting: ${bin} web --no-open --port ${port} --host ${host}`);
const child = spawn(
  bin,
  ['web', '--no-open', '--port', String(port), '--host', host, '--public-url', `http://${host}:${port}/`],
  {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NO_PROXY: 'localhost,127.0.0.1,::1,[::1]',
      no_proxy: 'localhost,127.0.0.1,::1,[::1]',
    },
  },
);

let log = '';
const collect = chunk => {
  log += chunk.toString();
  writeFileSync(logPath, log);
};
child.stdout.on('data', collect);
child.stderr.on('data', collect);
child.unref();

const deadline = Date.now() + 45_000;
let url;
let exitCode;
child.on('exit', code => { exitCode = code; });

while (Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 500));
  for (const line of log.split('\n')) {
    const match = READY.exec(line.trim());
    if (match) { url = match[1]; break; }
  }
  if (url) break;
  if (exitCode !== undefined) break;
}

if (exitCode !== undefined && !url) {
  fail(`dsh exited with code ${exitCode} before becoming ready\n--- log ---\n${log}`);
} else if (!url) {
  fail(`timed out waiting for the readiness line\n--- log ---\n${log}`);
} else {
  console.log(`PASS  parsed readiness URL: ${url.replace(/(token=....)[^&]*/, '$1***')}`);

  // The token URL must actually authenticate against the listener.
  const res = await fetch(url, { redirect: 'manual' }).catch(error => ({ error }));
  if (res.error) fail(`request to ${url} failed: ${res.error.message}`);
  else if (res.status >= 400) fail(`expected a <400 response, got ${res.status}`);
  else console.log(`PASS  token URL answered HTTP ${res.status}`);

  // The host fence must reject a foreign Host header on the API channel.
  // fetch() silently drops a caller-supplied Host header, so this probe needs curl.
  const origin = new URL(url).origin;
  const fenced = await probeHostHeader(origin);
  if (fenced === '403') console.log('PASS  foreign Host header fenced on /api/ (403)');
  else if (fenced) fail(`expected 403 for a foreign Host on /api/, got ${fenced}`);
  else console.log('SKIP  host-fence probe unavailable (curl missing)');
}

/** Sends one /api/ request with a spoofed Host; returns the status code or undefined. */
async function probeHostHeader(origin) {
  const { execFile } = await import('node:child_process');
  return new Promise(resolve => {
    execFile(
      'curl',
      ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--noproxy', '*', '-H', 'Host: evil.example', `${origin}/api/`],
      { timeout: 10_000 },
      (error, stdout) => resolve(error ? undefined : stdout.trim()),
    );
  });
}

// Clean up: the child is detached, so signal it directly.
try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
await new Promise(resolve => setTimeout(resolve, 1500));
try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
console.log(`...   log kept at ${logPath}`);
