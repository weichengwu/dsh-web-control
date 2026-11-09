#!/usr/bin/env node
// Packs dsh-web-control as the tarball DSH installs with:
//   dsh plugin --profile desktop add ./build/dsh-web-control.tgz
// npm-pack layout (`package/` prefix). No install scripts, no dependencies:
// DSH's bundled pnpm refuses packages with install scripts, and the host half
// imports nothing outside Node's standard library.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = message => { console.error(message); process.exit(1); };

const outDir = path.join(root, 'build');
const NAME = 'dsh-web-control';
const TGZ = path.join(outDir, `${NAME}.tgz`);

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

for (const required of ['dist/plugin.js', 'dist/client.js'])
  if (!existsSync(path.join(root, required))) fail(`Missing ${required}. Run "npm run build" first.`);

const manifest = {
  name: NAME,
  version: pkg.version,
  description: pkg.description,
  license: pkg.license,
  type: 'module',
  engines: pkg.engines,
  exports: pkg.exports,
  dsh: pkg.dsh,
};

const files = [
  ['package/package.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), 0o644],
  ['package/cordis.patch.yml', readFileSync(path.join(root, 'cordis.patch.yml')), 0o644],
  ['package/dist/plugin.js', readFileSync(path.join(root, 'dist', 'plugin.js')), 0o644],
  ['package/dist/client.js', readFileSync(path.join(root, 'dist', 'client.js')), 0o644],
];
if (existsSync(path.join(root, 'README.md')))
  files.push(['package/README.md', readFileSync(path.join(root, 'README.md')), 0o644]);
if (existsSync(path.join(root, 'README.zh.md')))
  files.push(['package/README.zh.md', readFileSync(path.join(root, 'README.zh.md')), 0o644]);

// --- ustar writer (fixed owner and time; gzip without a timestamp) ----------
const MTIME = Math.floor(Date.UTC(1985, 9, 26, 8, 15) / 1000);

function header512(name, size, mode) {
  if (Buffer.byteLength(name) > 100) fail(`Path too long for the archive: ${name}`);
  const block = Buffer.alloc(512);
  const put = (text, offset, length) => block.write(text, offset, length, 'utf8');
  const octal = (value, length) => value.toString(8).padStart(length - 1, '0') + '\0';

  put(name, 0, 100);
  put(octal(mode, 8), 100, 8);       // mode
  put(octal(0, 8), 108, 8);          // uid
  put(octal(0, 8), 116, 8);          // gid
  put(octal(size, 12), 124, 12);     // size
  put(octal(MTIME, 12), 136, 12);    // mtime
  block.fill(' ', 148, 156);         // checksum placeholder
  block[156] = '0'.charCodeAt(0);    // regular file
  put('ustar\0', 257, 6);
  put('00', 263, 2);

  let sum = 0;
  for (let i = 0; i < 512; i++) sum += block[i];
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return block;
}

function pad512(buffer) {
  const remainder = buffer.length % 512;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(512 - remainder);
}

const parts = [];
for (const [name, content, mode] of files) {
  parts.push(header512(name, content.length, mode), content, pad512(content));
}
parts.push(Buffer.alloc(1024)); // end-of-archive marker

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(TGZ, gzipSync(Buffer.concat(parts), { level: 9 }));
console.log(`packed ${path.relative(process.cwd(), TGZ)} (${files.length} files)`);
