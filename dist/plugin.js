import { createRequire as __dshWebControlRequire } from "node:module"; const require = __dshWebControlRequire(import.meta.url);

// build/host/config.js
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// build/host/types.js
var DshWebControlError = class extends Error {
  code;
  status;
  constructor(code, message, status2 = 500) {
    super(message);
    this.name = "DshWebControlError";
    this.code = code;
    this.status = status2;
  }
};
var DEFAULT_PORT = 3080;
var DEFAULT_CONFIG = Object.freeze({ bindHost: null, port: DEFAULT_PORT, autoStart: false });

// build/host/config.js
var IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
function isIPv4Literal(value) {
  return typeof value === "string" && IPV4.test(value.trim()) && value.trim() === value;
}
function stateDir() {
  return join(homedir(), ".dsh-web-control");
}
function configPath() {
  return join(stateDir(), "config.json");
}
function instancePath() {
  return join(stateDir(), "instance.json");
}
function logPath() {
  return join(stateDir(), "dshweb.log");
}
function urlPath() {
  return join(stateDir(), "url.txt");
}
async function ensureStateDir() {
  const dir = stateDir();
  await mkdir(dir, { recursive: true, mode: 448 });
  return dir;
}
function normalizeConfigValue(key, value) {
  switch (key) {
    case "bindHost": {
      if (value === null || value === void 0 || value === "")
        return null;
      if (typeof value !== "string") {
        throw new DshWebControlError("invalid_config", "bindHost \u5FC5\u987B\u662F IPv4 \u5B57\u9762\u91CF\uFF0C\u4F8B\u5982 192.168.1.100 \u6216 100.64.0.10", 400);
      }
      const trimmed = value.trim();
      if (!isIPv4Literal(trimmed)) {
        throw new DshWebControlError("invalid_config", `bindHost \u5FC5\u987B\u662F\u5177\u4F53 IPv4 \u5B57\u9762\u91CF\uFF08dsh \u62D2\u7EDD 0.0.0.0 \u901A\u914D\u5730\u5740\uFF09\uFF0C\u6536\u5230\uFF1A${JSON.stringify(value)}`, 400);
      }
      if (trimmed === "0.0.0.0") {
        throw new DshWebControlError("invalid_config", "dsh \u4E0D\u63A5\u53D7 0.0.0.0\uFF0C\u8BF7\u9009\u62E9\u4E00\u4E2A\u5177\u4F53\u5730\u5740\uFF08Tailscale / \u5C40\u57DF\u7F51 / 127.0.0.1\uFF09", 400);
      }
      return trimmed;
    }
    case "port": {
      const port = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      if (typeof port !== "number" || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
        throw new DshWebControlError("invalid_config", `port \u5FC5\u987B\u662F 1-65535 \u4E4B\u95F4\u7684\u6574\u6570\uFF0C\u6536\u5230\uFF1A${String(value)}`, 400);
      }
      return port;
    }
    case "autoStart": {
      if (typeof value !== "boolean") {
        throw new DshWebControlError("invalid_config", `autoStart \u5FC5\u987B\u662F\u5E03\u5C14\u503C\uFF0C\u6536\u5230\uFF1A${JSON.stringify(value)}`, 400);
      }
      return value;
    }
    default:
      throw new DshWebControlError("invalid_config", `\u672A\u77E5\u914D\u7F6E\u9879\uFF1A${String(key)}`, 400);
  }
}
var CONFIG_KEYS = ["bindHost", "port", "autoStart"];
function validateConfig(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new DshWebControlError("invalid_config", "\u914D\u7F6E\u5FC5\u987B\u662F JSON \u5BF9\u8C61", 400);
  }
  const record = input;
  for (const key of Object.keys(record)) {
    if (!CONFIG_KEYS.includes(key)) {
      throw new DshWebControlError("invalid_config", `\u672A\u77E5\u914D\u7F6E\u9879\uFF1A${key}\uFF08\u5141\u8BB8 bindHost / port / autoStart\uFF09`, 400);
    }
  }
  const config = { ...DEFAULT_CONFIG };
  if ("bindHost" in record)
    config.bindHost = normalizeConfigValue("bindHost", record.bindHost);
  if ("port" in record)
    config.port = normalizeConfigValue("port", record.port);
  if ("autoStart" in record)
    config.autoStart = normalizeConfigValue("autoStart", record.autoStart);
  return config;
}
async function loadConfig() {
  let raw;
  try {
    raw = await readFile(configPath(), "utf8");
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  try {
    return validateConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
async function saveConfig(config) {
  const validated = validateConfig(config);
  const dir = await ensureStateDir();
  const target = join(dir, "config.json");
  const temp = join(dir, `.config.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, `${JSON.stringify(validated, null, 2)}
`, { mode: 384 });
  await chmod(temp, 384);
  await rename(temp, target);
  await chmod(target, 384);
  return validated;
}
async function patchConfig(patch) {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new DshWebControlError("invalid_config", "\u914D\u7F6E\u8865\u4E01\u5FC5\u987B\u662F JSON \u5BF9\u8C61", 400);
  }
  const record = patch;
  const current = await loadConfig();
  const next = { ...current };
  for (const key of Object.keys(record)) {
    if (!CONFIG_KEYS.includes(key)) {
      throw new DshWebControlError("invalid_config", `\u672A\u77E5\u914D\u7F6E\u9879\uFF1A${key}\uFF08\u5141\u8BB8 bindHost / port / autoStart\uFF09`, 400);
    }
    const k = key;
    const value = normalizeConfigValue(k, record[key]);
    if (k === "bindHost")
      next.bindHost = value;
    else if (k === "port")
      next.port = value;
    else
      next.autoStart = value;
  }
  return saveConfig(next);
}

// build/host/process.js
import { spawn } from "node:child_process";
import { chmod as chmod2, open, readFile as readFile2, rename as rename2, rm, writeFile as writeFile2 } from "node:fs/promises";
import { join as join3 } from "node:path";
import { homedir as homedir3 } from "node:os";

// build/host/discover.js
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { networkInterfaces } from "node:os";
var TAILSCALE_BINARIES = [
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/bin/tailscale",
  "tailscale"
];
var PRIVATE_IPV4 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./
];
var LOOPBACK_HOST = "127.0.0.1";
function isTailscaleAddress(ip) {
  if (!isIPv4Literal(ip))
    return false;
  const first = Number(ip.split(".")[0]);
  const second = Number(ip.split(".")[1]);
  return first === 100 && second >= 64 && second <= 127;
}
function isPrivateAddress(ip) {
  return isIPv4Literal(ip) && PRIVATE_IPV4.some((pattern) => pattern.test(ip));
}
function run(command, args, timeoutMs = 2e3) {
  return new Promise((resolve) => {
    execFile(command, [...args], { timeout: timeoutMs, encoding: "utf8", windowsHide: true }, (error, stdout, stderr) => {
      if (error)
        resolve({ ok: false, stdout: typeof stdout === "string" ? stdout : "", stderr: typeof stderr === "string" ? stderr : String(error.message) });
      else
        resolve({ ok: true, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}
function localIPv4Addresses() {
  const result = [];
  const interfaces = networkInterfaces();
  for (const [iface, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      const isV4 = String(entry.family) === "IPv4";
      if (!isV4)
        continue;
      if (!isIPv4Literal(entry.address))
        continue;
      result.push({ iface, address: entry.address, internal: entry.internal === true });
    }
  }
  return result;
}
function isLocalAddress(ip) {
  if (!isIPv4Literal(ip))
    return false;
  if (ip.startsWith("127."))
    return true;
  return localIPv4Addresses().some((entry) => entry.address === ip);
}
function tailscaleBinary() {
  for (const candidate of TAILSCALE_BINARIES) {
    if (!candidate.includes("/"))
      continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
    }
  }
  return void 0;
}
async function detectTailscaleIPv4() {
  const fromEnv = process.env.DSH_WEB_TAILSCALE_IP;
  if (typeof fromEnv === "string" && isIPv4Literal(fromEnv.trim()))
    return fromEnv.trim();
  const binary = tailscaleBinary();
  if (binary) {
    const result = await run(binary, ["ip", "-4"]);
    if (result.ok) {
      const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== "");
      if (first !== void 0 && isIPv4Literal(first))
        return first;
    }
  }
  const fromInterfaces = localIPv4Addresses().find((entry) => isTailscaleAddress(entry.address));
  return fromInterfaces?.address;
}
async function detectLanIPv4() {
  const fromEnv = process.env.DSH_WEB_LAN_IP;
  if (typeof fromEnv === "string" && isIPv4Literal(fromEnv.trim()))
    return fromEnv.trim();
  const en0 = await run("/usr/sbin/ipconfig", ["getifaddr", "en0"]);
  const value = en0.stdout.trim();
  if (en0.ok && isIPv4Literal(value) && !isTailscaleAddress(value))
    return value;
  const entries = localIPv4Addresses();
  const preferred = entries.find((entry) => entry.iface === "en0" && isPrivateAddress(entry.address) && !isTailscaleAddress(entry.address));
  if (preferred)
    return preferred.address;
  const anyPrivate = entries.find((entry) => PRIVATE_IPV4.some((pattern) => pattern.test(entry.address)) && !entry.internal && !isTailscaleAddress(entry.address));
  return anyPrivate?.address;
}
function isOffline() {
  return !localIPv4Addresses().some((entry) => !entry.internal && !entry.address.startsWith("127."));
}
async function discoverCandidates() {
  const [tailscale, lan] = await Promise.all([detectTailscaleIPv4(), detectLanIPv4()]);
  const candidates = [];
  if (tailscale !== void 0)
    candidates.push({ label: `Tailscale\uFF08${tailscale}\uFF09`, host: tailscale, kind: "tailscale" });
  if (lan !== void 0 && lan !== tailscale)
    candidates.push({ label: `\u5C40\u57DF\u7F51\uFF08${lan}\uFF09`, host: lan, kind: "lan" });
  candidates.push({ label: "\u4EC5\u672C\u673A\uFF08127.0.0.1\uFF09", host: LOOPBACK_HOST, kind: "loopback" });
  return candidates;
}
async function resolveBindHost(configured) {
  const warnings = [];
  if (configured !== null) {
    if (isLocalAddress(configured))
      return { host: configured, warnings };
    warnings.push(`\u914D\u7F6E\u7684\u5730\u5740 ${configured} \u4E0D\u5728\u672C\u673A\u7F51\u5361\u4E0A\uFF08Tailscale \u53EF\u80FD\u5DF2\u65AD\u5F00\uFF09\uFF0C\u5DF2\u6539\u7528\u81EA\u52A8\u63A2\u6D4B\u5730\u5740\u3002`);
    const candidates2 = await discoverCandidates();
    const fallback = candidates2[0]?.host ?? LOOPBACK_HOST;
    return { host: fallback, warnings };
  }
  const candidates = await discoverCandidates();
  if (isOffline())
    warnings.push(`\u672A\u68C0\u6D4B\u5230\u5C40\u57DF\u7F51\u6216 Tailscale \u5730\u5740\uFF0C\u53EA\u80FD\u7ED1\u5B9A ${LOOPBACK_HOST}\uFF0C\u5916\u90E8\u8BBE\u5907\u5C06\u65E0\u6CD5\u8BBF\u95EE\u3002`);
  else if (candidates[0]?.kind === "loopback")
    warnings.push(`\u672A\u68C0\u6D4B\u5230\u5C40\u57DF\u7F51\u6216 Tailscale \u5730\u5740\uFF0C\u53EA\u80FD\u7ED1\u5B9A ${LOOPBACK_HOST}\uFF0C\u5916\u90E8\u8BBE\u5907\u5C06\u65E0\u6CD5\u8BBF\u95EE\u3002`);
  return { host: candidates[0]?.host ?? LOOPBACK_HOST, warnings };
}

// build/host/cli.js
import { constants as constants2, accessSync as accessSync2, existsSync, statSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { delimiter, join as join2 } from "node:path";
var ASAR_CLI = "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js";
var ELECTRON_BIN = "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness";
function isExecutable(path) {
  try {
    if (!statSync(path).isFile())
      return false;
    accessSync2(path, constants2.X_OK);
    return true;
  } catch {
    return false;
  }
}
function realFile(path) {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}
function resolveDshCommand() {
  const override = process.env.DSH_WEB_CONTROL_BIN;
  if (typeof override === "string" && override.trim() !== "") {
    const path = override.trim();
    if (isExecutable(path))
      return { command: path, prefixArgs: [], env: {}, source: "env" };
    throw new DshWebControlError("cli_not_found", `DSH_WEB_CONTROL_BIN \u6307\u5411\u7684\u53EF\u6267\u884C\u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u6267\u884C\uFF1A${path}`, 503);
  }
  const names = process.platform === "win32" ? ["dsh.cmd", "dsh.exe", "dsh"] : ["dsh"];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir === "")
      continue;
    for (const name2 of names) {
      const candidate = join2(dir, name2);
      if (isExecutable(candidate))
        return { command: candidate, prefixArgs: [], env: {}, source: "path" };
    }
  }
  if (isExecutable("/usr/local/bin/dsh"))
    return { command: "/usr/local/bin/dsh", prefixArgs: [], env: {}, source: "default-path" };
  if (isExecutable(ELECTRON_BIN) && realFile(ASAR_CLI)) {
    return { command: ELECTRON_BIN, prefixArgs: ["--expose-internals", ASAR_CLI], env: { ELECTRON_RUN_AS_NODE: "1" }, source: "electron-fallback" };
  }
  throw new DshWebControlError("cli_not_found", "\u627E\u4E0D\u5230 dsh \u53EF\u6267\u884C\u6587\u4EF6\u3002\u8BF7\u5728 PATH \u4E2D\u653E\u5165 dsh\uFF08\u4F8B\u5982 /usr/local/bin/dsh\uFF09\uFF0C\u6216\u7528\u73AF\u5883\u53D8\u91CF DSH_WEB_CONTROL_BIN \u6307\u5B9A\u5B83\u7684\u7EDD\u5BF9\u8DEF\u5F84\u3002", 503);
}
function childEnvironment(base = process.env) {
  const env = { ...base, HOME: homedir2() };
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"];
  for (const key of ["NO_PROXY", "no_proxy"]) {
    const current = typeof env[key] === "string" ? env[key].split(",").map((part) => part.trim()).filter((part) => part !== "") : [];
    env[key] = [...current, ...loopback.filter((host) => !current.includes(host))].join(",");
  }
  return env;
}

// build/host/process.js
var READY_LINE = /^dsh web: (https?:\/\/\S+)$/;
var READY_TIMEOUT_MS = 45e3;
var STOP_GRACE_MS = 15e3;
var POLL_INTERVAL_MS = 200;
function parseReadyLine(line) {
  const match = READY_LINE.exec(line.trim());
  return match?.[1];
}
var queue = Promise.resolve();
function serial(task) {
  const next = queue.then(task, task);
  queue = next.catch(() => void 0);
  return next;
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function portOwners(port) {
  return new Promise((resolve) => {
    if (process.platform === "win32")
      return resolve([]);
    const child = spawn("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += chunk.toString("utf8");
    });
    child.on("error", () => resolve([]));
    child.on("close", () => {
      const pids = out.split(/\s+/).map((part) => Number(part)).filter((pid) => Number.isSafeInteger(pid) && pid > 0);
      resolve([...new Set(pids)]);
    });
  });
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
async function readInstance() {
  try {
    const raw = await readFile2(instancePath(), "utf8");
    const value = JSON.parse(raw);
    return {
      pid: typeof value.pid === "number" ? value.pid : null,
      running: value.running === true,
      url: typeof value.url === "string" ? value.url : null,
      bindHost: typeof value.bindHost === "string" ? value.bindHost : null,
      port: typeof value.port === "number" ? value.port : null,
      startedAt: typeof value.startedAt === "number" ? value.startedAt : null,
      logFile: typeof value.logFile === "string" ? value.logFile : logPath(),
      ...typeof value.pgid === "number" ? { pgid: value.pgid } : {}
    };
  } catch {
    return emptyState();
  }
}
function emptyState() {
  return { pid: null, running: false, url: null, bindHost: null, port: null, startedAt: null, logFile: logPath() };
}
async function writeInstance(state, privateMode = true) {
  const dir = await ensureStateDir();
  const target = instancePath();
  const temp = join3(dir, `.instance.${process.pid}.${Date.now()}.tmp`);
  await writeFile2(temp, `${JSON.stringify(state, null, 2)}
`, { mode: privateMode ? 384 : 420 });
  await rename2(temp, target);
  if (privateMode)
    await chmod2(target, 384);
  if (typeof state.url === "string" && state.url !== "")
    await writeUrlFile(state.url);
}
async function writeUrlFile(url) {
  const dir = await ensureStateDir();
  const target = urlPath();
  const temp = join3(dir, `.url.${process.pid}.${Date.now()}.tmp`);
  await writeFile2(temp, `${url}
`, { mode: 384 });
  await chmod2(temp, 384);
  await rename2(temp, target);
  await chmod2(target, 384);
}
async function currentState() {
  const stored = await readInstance();
  if (!stored.running)
    return stored;
  const alive = stored.pid !== null && isProcessAlive(stored.pid);
  const listening = stored.port !== null && (await portOwners(stored.port)).length > 0;
  if (alive && listening)
    return stored;
  const stale = { ...stored, running: false, url: null, pid: alive ? stored.pid : null };
  await writeInstance(stale, false);
  await rm(urlPath(), { force: true });
  return stale;
}
async function statusWith(candidates) {
  const [state, config] = await Promise.all([currentState(), loadConfig()]);
  const { host, warnings } = await resolveBindHost(config.bindHost);
  const { pgid: _pgid, ...stateWithoutPgid } = state;
  return { ...stateWithoutPgid, candidates, effectiveHost: host, config, warnings };
}
async function status() {
  return serial(async () => statusWith(await discoverCandidates()));
}
async function readLog(lines = 200) {
  const count = Number.isSafeInteger(lines) && lines > 0 ? Math.min(lines, 2e3) : 200;
  let raw;
  try {
    raw = await readFile2(logPath(), "utf8");
  } catch {
    return "";
  }
  const all = raw.split(/\r?\n/);
  if (all.length > 0 && all[all.length - 1] === "")
    all.pop();
  return all.slice(-count).join("\n");
}
function waitForSpawn(child) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (error) => {
      if (settled)
        return;
      settled = true;
      clearInterval(poll);
      resolve(error);
    };
    const poll = setInterval(() => {
      if (child.pid !== void 0)
        settle(void 0);
    }, 25);
    child.once("error", (error) => settle(error));
    child.once("spawn", () => settle(void 0));
    if (child.pid !== void 0)
      settle(void 0);
  });
}
function watchExitOf(child) {
  const watch = {};
  child.once("exit", (code, signal) => {
    watch.result = { code, signal };
  });
  return watch;
}
async function waitForReady(watch, port, deadline) {
  const exited = () => watch.result;
  while (Date.now() < deadline) {
    const text = await readLog(400);
    const lines = text.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const url = parseReadyLine(lines[index] ?? "");
      if (url !== void 0 && url.includes(`:${port}/`))
        return url;
    }
    if (exited() !== void 0) {
      const tail2 = await readLog(40);
      const { code, signal } = exited();
      throw new DshWebControlError("start_failed", `dsh web \u542F\u52A8\u5931\u8D25\uFF08\u9000\u51FA\u7801 ${String(code)}${signal ? `\uFF0C\u4FE1\u53F7 ${signal}` : ""}\uFF09\u3002\u65E5\u5FD7\u5C3E\u90E8\uFF1A
${tail2}`, 500);
    }
    await delay(POLL_INTERVAL_MS);
  }
  const tail = await readLog(40);
  throw new DshWebControlError("start_timeout", `\u7B49\u5F85 dsh web \u5C31\u7EEA\u8D85\u65F6\uFF08${READY_TIMEOUT_MS / 1e3}s\uFF09\u3002\u65E5\u5FD7\u5C3E\u90E8\uFF1A
${tail}`, 500);
}
async function start(options = {}) {
  return serial(async () => {
    const config = await loadConfig();
    const candidates = await discoverCandidates();
    let bindHost;
    if (options.host !== void 0)
      bindHost = normalizeConfigValue("bindHost", options.host) ?? "";
    else
      bindHost = config.bindHost ?? "";
    const resolved = await resolveBindHost(bindHost === "" ? null : bindHost);
    const host = resolved.host;
    const warnings = [...resolved.warnings];
    const port = options.port !== void 0 ? normalizeConfigValue("port", options.port) : config.port;
    if (!isIPv4Literal(host))
      throw new DshWebControlError("invalid_host", `\u65E0\u6CD5\u786E\u5B9A\u7ED1\u5B9A\u5730\u5740\uFF1A${host}`, 400);
    const state = await currentState();
    if (state.running && state.port === port && state.bindHost === host)
      return statusWith(candidates);
    if (state.running)
      throw new DshWebControlError("already_running", `dsh web \u5DF2\u5728 ${state.bindHost ?? "?"}:${String(state.port)} \u8FD0\u884C\uFF0C\u8BF7\u5148\u505C\u6B62\u6216\u4F7F\u7528\u91CD\u542F\u3002`, 409);
    const owners = await portOwners(port);
    if (owners.length > 0) {
      throw new DshWebControlError("port_in_use", `\u7AEF\u53E3 ${port} \u5DF2\u88AB\u5360\u7528\uFF08PID ${owners.join(", ")}\uFF09\uFF0C\u8BF7\u6362\u4E00\u4E2A\u7AEF\u53E3\u3002`, 409);
    }
    const command = resolveDshCommand();
    const dir = await ensureStateDir();
    const file = logPath();
    const out = await open(file, "w", 384);
    await chmod2(file, 384);
    const publicUrl = `http://${host}:${port}/`;
    const args = [...command.prefixArgs, "web", "--no-open", "--port", String(port), "--host", host, "--public-url", publicUrl];
    const startedAt = Date.now();
    let child;
    try {
      child = spawn(command.command, args, {
        detached: true,
        stdio: ["ignore", out.fd, out.fd],
        env: { ...childEnvironment(), ...command.env },
        cwd: homedir3()
      });
    } catch (error) {
      await out.close().catch(() => void 0);
      throw new DshWebControlError("spawn_failed", `\u65E0\u6CD5\u542F\u52A8 dsh\uFF1A${error.message}`, 500);
    }
    await out.close().catch(() => void 0);
    const spawnError = await waitForSpawn(child);
    if (spawnError)
      throw new DshWebControlError("spawn_failed", `\u65E0\u6CD5\u542F\u52A8 dsh\uFF08${command.command}\uFF09\uFF1A${spawnError.message}`, 500);
    const pid = child.pid ?? null;
    if (pid === null)
      throw new DshWebControlError("spawn_failed", "dsh \u8FDB\u7A0B\u6CA1\u6709\u8FD4\u56DE pid\u3002", 500);
    await writeInstance({ pid, running: false, url: null, bindHost: host, port, startedAt, logFile: file, pgid: pid }, false);
    try {
      const watchExit = watchExitOf(child);
      child.unref();
      const url = await waitForReady(watchExit, port, startedAt + READY_TIMEOUT_MS);
      const ready = await waitListening(port, Math.min(1e4, READY_TIMEOUT_MS));
      if (!ready)
        warnings.push(`\u65E5\u5FD7\u5DF2\u663E\u793A\u5C31\u7EEA\u5730\u5740\uFF0C\u4F46\u7AEF\u53E3 ${port} \u5C1A\u672A\u76D1\u542C\uFF08\u53EF\u80FD\u4ECD\u5728\u521D\u59CB\u5316\uFF09\u3002`);
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
async function waitListening(port, budgetMs) {
  const deadline = Date.now() + budgetMs;
  for (; ; ) {
    if ((await portOwners(port)).length > 0)
      return true;
    if (Date.now() >= deadline)
      return false;
    await delay(POLL_INTERVAL_MS * 2);
  }
}
async function terminate(pid) {
  if (!isProcessAlive(pid))
    return true;
  const group = (signal) => {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
      }
    }
  };
  group("SIGTERM");
  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid))
      return true;
    await delay(POLL_INTERVAL_MS);
  }
  group("SIGKILL");
  const killDeadline = Date.now() + 5e3;
  while (Date.now() < killDeadline) {
    if (!isProcessAlive(pid))
      return true;
    await delay(POLL_INTERVAL_MS);
  }
  return !isProcessAlive(pid);
}
async function stop() {
  return serial(async () => {
    const state = await currentState();
    if (state.running && state.pid !== null) {
      const stopped = await terminate(state.pid);
      if (!stopped)
        throw new DshWebControlError("stop_failed", `\u65E0\u6CD5\u505C\u6B62 dsh web\uFF08PID ${state.pid}\uFF09\u3002`, 500);
    }
    await rm(instancePath(), { force: true });
    await rm(urlPath(), { force: true });
    return statusWith(await discoverCandidates());
  });
}
async function restart(options = {}) {
  await stop();
  return start(options);
}
async function configSnapshot() {
  const [config, candidates] = await Promise.all([loadConfig(), discoverCandidates()]);
  return { config, candidates };
}

// build/host/constants.js
var CONFIG_PATH = configPath();
var LOG_PATH = logPath();
var STATE_DIR = stateDir();

// build/host/admin.js
var API_PREFIX = "/api/dsh-web-control";
function json(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
function failure(statusCode, code, message) {
  return json(statusCode, { error: { code, message } });
}
function isDshWebControlError(error) {
  return error instanceof Error && error.name === "DshWebControlError" && typeof error.code === "string";
}
function toFailure(error) {
  if (error instanceof RequestError)
    return failure(error.status, error.code, error.message);
  if (isDshWebControlError(error))
    return failure(error.status, error.code, error.message);
  const message = error instanceof Error ? error.message : String(error);
  return failure(500, "internal_error", message);
}
var RequestError = class extends Error {
  status;
  code;
  constructor(status2, code, message) {
    super(message);
    this.name = "RequestError";
    this.status = status2;
    this.code = code;
  }
};
async function readBody(request) {
  let text;
  try {
    text = await request.text();
  } catch {
    return {};
  }
  if (text.trim() === "")
    return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RequestError(400, "invalid_request", "\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RequestError(400, "invalid_request", "\u8BF7\u6C42\u4F53\u5FC5\u987B\u662F JSON \u5BF9\u8C61");
  }
  return parsed;
}
function overrides(body) {
  const options = {};
  if (body.host !== void 0 && body.host !== null)
    options.host = String(body.host);
  if (body.port !== void 0 && body.port !== null)
    options.port = body.port;
  return options;
}
function createDshWebControlRoutes() {
  const withOverrides = async (request, action) => {
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      return toFailure(error);
    }
    try {
      const patch = {};
      if (body.host !== void 0)
        patch.bindHost = body.host;
      if (body.port !== void 0)
        patch.port = body.port;
      if (Object.keys(patch).length > 0)
        await patchConfig(patch);
      return json(200, await action(overrides(body)));
    } catch (error) {
      return toFailure(error);
    }
  };
  const statusRoute = async () => {
    try {
      return json(200, await status());
    } catch (error) {
      return toFailure(error);
    }
  };
  const startRoute = (request) => withOverrides(request, (options) => start(options));
  const stopRoute = async (_request) => {
    try {
      return json(200, await stop());
    } catch (error) {
      return toFailure(error);
    }
  };
  const restartRoute = (request) => withOverrides(request, (options) => restart(options));
  const logRoute = async (request) => {
    try {
      const raw = new URL(request.url).searchParams.get("lines");
      const parsed = raw === null || raw.trim() === "" ? 200 : Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2e3) {
        return failure(400, "invalid_request", "lines \u5FC5\u987B\u662F 1-2000 \u4E4B\u95F4\u7684\u6574\u6570");
      }
      return json(200, { log: await readLog(parsed) });
    } catch (error) {
      return toFailure(error);
    }
  };
  const configGet = async () => {
    try {
      return json(200, await configSnapshot());
    } catch (error) {
      return toFailure(error);
    }
  };
  const configPost = async (request) => {
    try {
      const body = await readBody(request);
      await patchConfig(body);
      return json(200, await configSnapshot());
    } catch (error) {
      return toFailure(error);
    }
  };
  const candidatesRoute = async () => {
    try {
      const snapshot = await configSnapshot();
      return json(200, { candidates: snapshot.candidates });
    } catch (error) {
      return toFailure(error);
    }
  };
  const infoRoute = async () => json(200, { stateDir: STATE_DIR, configPath: CONFIG_PATH, logPath: LOG_PATH });
  return [
    { path: `${API_PREFIX}/status`, methods: ["GET"], requestBody: "buffered", fetch: statusRoute },
    { path: `${API_PREFIX}/start`, methods: ["POST"], requestBody: "buffered", fetch: startRoute },
    { path: `${API_PREFIX}/stop`, methods: ["POST"], requestBody: "buffered", fetch: stopRoute },
    { path: `${API_PREFIX}/restart`, methods: ["POST"], requestBody: "buffered", fetch: restartRoute },
    { path: `${API_PREFIX}/log`, methods: ["GET"], requestBody: "buffered", fetch: logRoute },
    { path: `${API_PREFIX}/config`, methods: ["GET", "POST"], requestBody: "buffered", fetch: (request) => request.method === "POST" ? configPost(request) : configGet() },
    { path: `${API_PREFIX}/candidates`, methods: ["GET"], requestBody: "buffered", fetch: candidatesRoute },
    { path: `${API_PREFIX}/info`, methods: ["GET"], requestBody: "buffered", fetch: infoRoute }
  ];
}

// build/host/tools.js
var ACTIONS = ["status", "start", "stop", "restart", "url"];
function summarize(state, message) {
  return { running: state.running, url: state.url, bindHost: state.bindHost, port: state.port, message };
}
function describe(state) {
  if (!state.running)
    return "dsh web \u672A\u8FD0\u884C\u3002";
  const where = `${state.bindHost ?? "?"}:${String(state.port)}`;
  return `dsh web \u8FD0\u884C\u4E2D\uFF0C\u76D1\u542C ${where}\u3002${state.url ? `\u8BBF\u95EE\u5730\u5740\uFF1A${state.url}` : "\u5C31\u7EEA\u5730\u5740\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u67E5\u770B\u65E5\u5FD7\u3002"}`;
}
function webControlTool() {
  return {
    name: "dsh_web_control",
    description: "\u7BA1\u7406\u672C\u673A\u7684 dsh web \u5B9E\u4F8B\uFF08\u53EF\u88AB\u5C40\u57DF\u7F51 / Tailscale \u8BBF\u95EE\uFF09\u3002 action=status \u67E5\u770B\u72B6\u6001\uFF1Bstart \u542F\u52A8\u5E76\u8FD4\u56DE\u5E26 token \u7684\u5B8C\u6574\u8BBF\u95EE\u5730\u5740\uFF1Bstop \u505C\u6B62\uFF1Brestart \u91CD\u542F\uFF1Burl \u53EA\u53D6\u5F53\u524D\u5B8C\u6574\u5730\u5740\u3002 \u53EF\u9009 host\uFF08\u5177\u4F53 IPv4 \u5B57\u9762\u91CF\uFF0C\u5982 100.64.0.10 \u6216 192.168.1.100\uFF0C\u4E0D\u80FD\u662F 0.0.0.0\uFF09\u548C port \u8986\u76D6\u672C\u6B21\u542F\u52A8\u3002",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { type: "string", enum: [...ACTIONS], description: "\u8981\u6267\u884C\u7684\u64CD\u4F5C\u3002" },
        host: { type: "string", description: "\u7ED1\u5B9A\u5730\u5740\uFF0C\u5177\u4F53 IPv4 \u5B57\u9762\u91CF\uFF1B\u7701\u7565\u5219\u4F7F\u7528\u5DF2\u4FDD\u5B58\u914D\u7F6E\u6216\u81EA\u52A8\u63A2\u6D4B\u3002" },
        port: { type: "integer", minimum: 1, maximum: 65535, description: "\u7AEF\u53E3\uFF1B\u7701\u7565\u5219\u4F7F\u7528\u5DF2\u4FDD\u5B58\u914D\u7F6E\uFF08\u9ED8\u8BA4 3080\uFF09\u3002" }
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["running", "url", "bindHost", "port", "message"],
        properties: {
          running: { type: "boolean" },
          url: { type: "string", description: "\u5F53\u524D\u8BBF\u95EE\u5730\u5740\uFF1B\u672A\u8FD0\u884C\u65F6\u4E3A\u7A7A\u5B57\u7B26\u4E32\u3002" },
          bindHost: { type: "string", description: "\u7ED1\u5B9A\u5730\u5740\uFF1B\u672A\u7ED1\u5B9A\u65F6\u4E3A\u7A7A\u5B57\u7B26\u4E32\u3002" },
          port: { type: "integer", description: "\u7AEF\u53E3\uFF1B\u672A\u8FD0\u884C\u65F6\u4E3A 0\u3002" },
          message: { type: "string" }
        }
      },
      render: (_args, value) => [{ type: "text", text: value.message }]
    },
    timeoutMs: 12e4,
    async execute(args) {
      const action = typeof args.action === "string" ? args.action : void 0;
      if (action === void 0 || !ACTIONS.includes(action)) {
        throw new Error(`dsh_web_control \u9700\u8981 action\uFF0C\u53D6\u503C\uFF1A${ACTIONS.join(" | ")}`);
      }
      const options = {};
      if (args.host !== void 0 && args.host !== null) {
        if (typeof args.host !== "string")
          throw new Error("dsh_web_control \u7684 host \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\uFF08IPv4 \u5B57\u9762\u91CF\uFF09");
        options.host = args.host;
      }
      if (args.port !== void 0 && args.port !== null) {
        if (typeof args.port !== "number")
          throw new Error("dsh_web_control \u7684 port \u5FC5\u987B\u662F\u6574\u6570");
        options.port = args.port;
      }
      switch (action) {
        case "status": {
          const state = await status();
          return summarize(state, state.running ? describe(state) : `${describe(state)}${state.warnings.length > 0 ? `\uFF08${state.warnings.join(" ")}\uFF09` : ""}`);
        }
        case "start": {
          const state = await start(options);
          return summarize(state, `\u5DF2\u542F\u52A8\u3002${describe(state)}`);
        }
        case "stop": {
          const state = await stop();
          return summarize(state, "dsh web \u5DF2\u505C\u6B62\u3002");
        }
        case "restart": {
          const state = await restart(options);
          return summarize(state, `\u5DF2\u91CD\u542F\u3002${describe(state)}`);
        }
        case "url": {
          const state = await status();
          return summarize(state, state.running && state.url ? `\u5F53\u524D\u8BBF\u95EE\u5730\u5740\uFF1A${state.url}` : "dsh web \u672A\u8FD0\u884C\uFF0C\u6CA1\u6709\u8BBF\u95EE\u5730\u5740\u3002");
        }
      }
    }
  };
}
function toResult(snapshot) {
  const { config, candidates } = snapshot;
  return {
    config: { ...config, bindHost: config.bindHost ?? "" },
    candidates,
    autoBind: config.bindHost === null
  };
}
function webConfigTool() {
  return {
    name: "dsh_web_config",
    description: "\u8BFB\u53D6\u6216\u4FEE\u6539 dsh-web-control \u7684\u6301\u4E45\u5316\u914D\u7F6E\uFF08~/.dsh-web-control/config.json\uFF09\uFF1AbindHost\uFF08IPv4 \u5B57\u9762\u91CF\u6216 null=\u81EA\u52A8\u63A2\u6D4B\uFF09\u3001port\uFF081-65535\uFF0C\u9ED8\u8BA4 3080\uFF09\u3001autoStart\uFF08\u9996\u6B21\u8BBF\u95EE\u63D2\u4EF6\u65F6\u662F\u5426\u81EA\u52A8\u542F\u52A8\uFF09\u3002 \u4E0D\u4F20\u4EFB\u4F55\u53C2\u6570\u5373\u4E3A\u8BFB\u53D6\u3002\u8FD4\u56DE\u5F53\u524D\u914D\u7F6E\u4E0E\u53EF\u7528\u5730\u5740\u5019\u9009\u3002",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        bindHost: { type: "string", description: '\u7ED1\u5B9A\u5730\u5740\uFF0C\u5FC5\u987B\u662F\u5177\u4F53 IPv4 \u5B57\u9762\u91CF\uFF1B\u4F20 "auto" \u8868\u793A\u6062\u590D\u81EA\u52A8\u63A2\u6D4B\u3002' },
        port: { type: "integer", minimum: 1, maximum: 65535, description: "\u7AEF\u53E3\u3002" },
        autoStart: { type: "boolean", description: "\u9996\u6B21\u8BBF\u95EE\u63D2\u4EF6\u65F6\u81EA\u52A8\u542F\u52A8\u3002" }
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["config", "candidates", "autoBind"],
        properties: {
          config: {
            type: "object",
            additionalProperties: false,
            required: ["bindHost", "port", "autoStart"],
            properties: {
              bindHost: { type: "string", description: "\u7ED1\u5B9A\u5730\u5740\uFF1B\u81EA\u52A8\u63A2\u6D4B\u65F6\u4E3A\u7A7A\u5B57\u7B26\u4E32\u3002" },
              port: { type: "integer" },
              autoStart: { type: "boolean" }
            }
          },
          autoBind: { type: "boolean", description: "true \u8868\u793A bindHost \u8D70\u81EA\u52A8\u63A2\u6D4B\u3002" },
          candidates: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "host", "kind"],
              properties: { label: { type: "string" }, host: { type: "string" }, kind: { type: "string", enum: ["tailscale", "lan", "loopback"] } }
            }
          }
        }
      },
      render: (_args, value) => [
        { type: "text", text: `bindHost=${value.config.bindHost || "\u81EA\u52A8"} port=${value.config.port} autoStart=${String(value.config.autoStart)}\uFF1B\u5019\u9009\u5730\u5740\uFF1A${value.candidates.map((item) => `${item.host}(${item.kind})`).join("\u3001")}` }
      ]
    },
    timeoutMs: 3e4,
    async execute(args) {
      const patch = {};
      if (args.bindHost !== void 0)
        patch.bindHost = args.bindHost === "auto" ? null : args.bindHost;
      if (args.port !== void 0)
        patch.port = args.port;
      if (args.autoStart !== void 0)
        patch.autoStart = args.autoStart;
      if (Object.keys(patch).length > 0)
        await patchConfig(patch);
      return toResult(await configSnapshot());
    }
  };
}
function webControlTools() {
  return [webControlTool(), webConfigTool()];
}

// build/host/plugin.js
var PLUGIN_NAME = "dsh-web-control";
var name = PLUGIN_NAME;
var version = "0.1.0";
var inject = [];
function disposeAll(disposers) {
  return async () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        await dispose();
      } catch {
      }
    }
  };
}
function registerRoutes(ctx) {
  const connection = ctx.connection;
  const fetch = connection?.fetch;
  if (typeof fetch?.register !== "function")
    return void 0;
  const disposers = [];
  try {
    for (const route of createDshWebControlRoutes())
      disposers.push(fetch.register(route));
  } catch (error) {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {
      }
    }
    throw error;
  }
  return disposeAll(disposers);
}
function registerTools(ctx) {
  const tools = ctx.tools;
  if (typeof tools?.register !== "function")
    return void 0;
  const disposers = [];
  try {
    for (const tool of webControlTools())
      disposers.push(tools.register(tool));
  } catch (error) {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {
      }
    }
    throw error;
  }
  return disposeAll(disposers);
}
function track(disposers, dispose) {
  if (dispose === void 0)
    return void 0;
  disposers.push(dispose);
  return dispose;
}
function wire(ctx) {
  const disposers = [];
  if (typeof ctx.inject === "function") {
    const guarded = (register) => (scoped) => {
      try {
        return track(disposers, register(scoped));
      } catch (error) {
        process.emitWarning(`dsh-web-control: \u6CE8\u518C\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
        return void 0;
      }
    };
    ctx.inject(["connection"], guarded(registerRoutes));
    ctx.inject(["tools"], guarded(registerTools));
    return () => {
      for (const dispose of disposers.splice(0))
        dispose();
    };
  }
  const routesDispose = registerRoutes(ctx);
  if (routesDispose !== void 0)
    disposers.push(routesDispose);
  const toolsDispose = registerTools(ctx);
  if (toolsDispose !== void 0)
    disposers.push(toolsDispose);
  return disposers.length === 0 ? void 0 : disposeAll(disposers);
}
async function bootstrap() {
  await ensureStateDir();
  const config = await loadConfig();
  if (!config.autoStart)
    return;
  const state = await currentState();
  if (state.running)
    return;
  try {
    await start({});
  } catch (error) {
    process.emitWarning(`dsh-web-control: \u81EA\u52A8\u542F\u52A8\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
  }
}
async function apply(ctx, _config) {
  const teardown = wire(ctx);
  try {
    await bootstrap();
  } catch (error) {
    process.emitWarning(`dsh-web-control: \u521D\u59CB\u5316\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
  }
  return async () => {
    if (teardown !== void 0)
      await teardown();
  };
}
var paths = { stateDir, logPath };
var plugin_default = { name, inject, apply };
export {
  PLUGIN_NAME,
  apply,
  plugin_default as default,
  inject,
  name,
  paths,
  registerRoutes,
  registerTools,
  version
};
