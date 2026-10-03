#!/usr/bin/env node
// The web version's shelf on this machine, to try a pack before it goes to the home server
// (Plans/spelen-in-de-browser.md). The same rules as deploy/play/nginx.conf, as far as a page can
// tell: / goes to /play/, the door and version.json uncached, a shelf immutable, x.gz served for x
// when the browser takes gzip, and .mjs as JavaScript. Nothing else - no islander, no sea.
//
//   node scripts/pack-web.mjs --sea http://localhost:4761/   (and `node sea.mjs --port 4761`)
//   node scripts/serve-play.mjs [--port 4760] [--dir dist/play]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const port = Number(arg('port', process.env.PORT || 4760));
const dir = path.resolve(ROOT, arg('dir', 'dist/play'));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://play').pathname);
  if (p === '/' || p === '/play') { res.writeHead(302, { Location: '/play/' }); res.end(); return; }
  if (!p.startsWith('/play/')) { res.writeHead(404); res.end(); return; }
  p = p.slice('/play/'.length);
  if (p === '' || p.endsWith('/')) p += 'index.html';
  const file = path.resolve(dir, p);
  if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  const changing = !p.includes('/');   // the door and version.json, at the top of the shelf
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && fs.existsSync(`${file}.gz`);
  const body = fs.readFileSync(gz ? `${file}.gz` : file);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': changing ? 'no-cache' : 'public, max-age=31536000, immutable',
    'Vary': 'Accept-Encoding',
    ...(gz ? { 'Content-Encoding': 'gzip' } : {}),
  });
  res.end(body);
}).listen(port, () => process.stdout.write(`serve-play: ${dir} on http://localhost:${port}/play/\n`));
