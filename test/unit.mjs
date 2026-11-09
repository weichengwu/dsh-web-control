#!/usr/bin/env node
// Unit tests for dsh-web-control's pure logic: config validation, address discovery,
// and the readiness-line parser whose exact rules were established against a real
// `dsh web` run (see test/acceptance.mjs).
//
//   node test/unit.mjs        # after `tsc -p host/tsconfig.json`
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
// tsc emits the individual modules to build/host; dist/ holds only the two bundled
// files the package ships. The unit tests load the former.
const dist = path.join(root, 'build', 'host');
const load = name => import(pathToFileURL(path.join(dist, `${name}.js`)).href);

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

const { parseReadyLine, READY_LINE } = await load('process');
const { isIPv4Literal, normalizeConfigValue, validateConfig } = await load('config');
const { DEFAULT_CONFIG } = await load('types');

// --- readiness line ---------------------------------------------------------
// The exact two lines a real `dsh web` run printed, in order.
const WARNING = 'dsh web: listening on 100.66.66.20 over plain HTTP; restrict this port to a trusted proxy or network';
const READY = 'dsh web: http://100.66.66.20:3080/?token=abc123';

await test('parses the real ready line', () => {
  assert.equal(parseReadyLine(READY), 'http://100.66.66.20:3080/?token=abc123');
});

await test('ignores the plain-HTTP warning line', () => {
  assert.equal(parseReadyLine(WARNING), undefined);
});

await test('a warning followed by a ready line yields only the URL', () => {
  const lines = [WARNING, READY].map(line => parseReadyLine(line));
  assert.deepEqual(lines, [undefined, 'http://100.66.66.20:3080/?token=abc123']);
});

await test('tolerates surrounding whitespace', () => {
  assert.equal(parseReadyLine(`  ${READY}  `), 'http://100.66.66.20:3080/?token=abc123');
});

await test('accepts an https ready line (TLS deployments)', () => {
  assert.equal(parseReadyLine('dsh web: https://host.example/?token=t'), 'https://host.example/?token=t');
});

await test('rejects unrelated dsh web lines', () => {
  assert.equal(parseReadyLine('dsh web: opening the default browser; pass --no-open to disable'), undefined);
});

await test('READY_LINE is anchored (no substring matches)', () => {
  assert.equal(READY_LINE.exec(`prefix ${READY}`), null);
});

// --- IPv4 validation --------------------------------------------------------
await test('accepts dotted-quad literals', () => {
  for (const ip of ['127.0.0.1', '192.168.31.115', '100.66.66.20', '0.0.0.0']) assert.equal(isIPv4Literal(ip), true, ip);
});

await test('rejects wildcard-as-string variants and non-literals', () => {
  for (const ip of ['localhost', '100.66.66', '256.1.1.1', '1.1.1.1:3080', '100.64.0.0/10', '', ' 1.1.1.1', '::1'])
    assert.equal(isIPv4Literal(ip), false, JSON.stringify(ip));
});

// --- config validation ------------------------------------------------------
await test('port accepts 1..65535 and rejects the rest', () => {
  assert.equal(normalizeConfigValue('port', 3080), 3080);
  assert.equal(normalizeConfigValue('port', '8080'), 8080);
  for (const bad of [0, 65536, -1, 3.5, 'abc', null]) assert.throws(() => normalizeConfigValue('port', bad), String(bad));
});

await test('bindHost accepts a literal or null only', () => {
  assert.equal(normalizeConfigValue('bindHost', '192.168.31.115'), '192.168.31.115');
  assert.equal(normalizeConfigValue('bindHost', null), null);
  for (const bad of ['localhost', '0.0.0.0/0', 7]) assert.throws(() => normalizeConfigValue('bindHost', bad), String(bad));
});

await test('autoStart is strictly boolean', () => {
  assert.equal(normalizeConfigValue('autoStart', true), true);
  assert.equal(normalizeConfigValue('autoStart', false), false);
  for (const bad of ['true', 1, null]) assert.throws(() => normalizeConfigValue('autoStart', bad), String(bad));
});

await test('validateConfig rejects unknown keys', () => {
  assert.throws(() => validateConfig({ bindHost: null, nope: 1 }), /未知配置项/);
});

await test('validateConfig fills defaults', () => {
  const config = validateConfig({});
  assert.deepEqual(config, { bindHost: null, port: 3080, autoStart: false });
});

await test('DEFAULT_CONFIG is frozen with the documented defaults', () => {
  // Compare the spread, not the frozen object itself: assert.deepEqual treats a frozen
  // object's properties as non-enumerable, so the spread is the faithful comparison.
  assert.deepEqual({ ...DEFAULT_CONFIG }, { bindHost: null, port: 3080, autoStart: false });
  assert.equal(Object.isFrozen(DEFAULT_CONFIG), true);
});

// --- build hygiene ----------------------------------------------------------
await test('the built plugin has no third-party imports', () => {
  const source = readFileSync(path.join(dist, 'plugin.js'), 'utf8');
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    assert.ok(specifier.startsWith('node:') || specifier.startsWith('.'), `unexpected import: ${specifier}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
