#!/usr/bin/env node
// Builds dsh-web-control:
//   1. host/src/*.ts --tsc--> dist/*.js (ES modules, run directly by DSH)
//   2. client/index.js --esbuild--> dist/client.js wrapped in the DSH module-loader header
// The host half has zero third-party dependencies: everything comes from Node's standard library.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const require = createRequire(path.join(root, 'host', 'package.json'));

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!existsSync(path.join(root, 'dist'))) mkdirSync(path.join(root, 'dist'), { recursive: true });

// --- 1. host half -----------------------------------------------------------
const esbuildPath = path.join(root, 'host', 'node_modules', 'esbuild');
let build;
try { ({ build } = require(esbuildPath)); } catch { ({ build } = require('esbuild')); }

// The host is emitted by tsc (see tsconfig); bundle it into ONE ES module so the
// published package needs only dist/plugin.js and dist/client.js. DSH imports the
// entry by path from the profile's node_modules, and a multi-file dist would leak
// sibling modules the package's `exports` map does not advertise.
const host = await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'build', 'host', 'plugin.js')],
  outfile: path.join(root, 'dist', 'plugin.js'),
  bundle: true,
  write: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['bufferutil', 'utf-8-validate'],
  legalComments: 'inline',
  logLevel: 'error',
  banner: {
    js: 'import { createRequire as __dshWebControlRequire } from "node:module"; const require = __dshWebControlRequire(import.meta.url);',
  },
});
const hostEntry = path.join(root, 'dist', 'plugin.js');
if (!existsSync(hostEntry)) throw new Error('esbuild produced no host bundle');

// --- 2. browser half -------------------------------------------------------
const name = pkg.name;
const clientEntry = path.join(root, 'client', 'index.js');
if (!existsSync(clientEntry)) {
  console.log('client/index.js missing; skipping browser half');
  process.exit(0);
}
const client = await build({
  entryPoints: [clientEntry],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  external: ['react'],
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  logLevel: 'error',
});
const code = client.outputFiles[0].text;
writeFileSync(
  path.join(root, 'dist', 'client.js'),
  `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(name)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n${code}\n\t\treturn module.exports;\n\t}\n});\n`,
);
console.log('built dist/plugin.js and dist/client.js');
