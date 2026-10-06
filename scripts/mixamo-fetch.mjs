// Fetches animations and characters from mixamo.com in bulk, under the keeper's own login.
// The game never reads what lands here: a clip goes into assets/mixamo/ only when somebody
// copies it there on purpose (the mixamo-clips skill), so gigabytes of FBX stay out of git
// and out of the repository Adobe's terms keep them out of anyway.
//
// It talks to the same web API the mixamo.com page does, with the bearer token of a logged-in
// browser (localStorage `access_token`). The token is read from MIXAMO_TOKEN or a file the
// keeper fills himself (--token-file, default <out>/token.txt) and is never printed, logged
// or written into a manifest. No dependency: Node 22's fetch.
//
//   node scripts/mixamo-fetch.mjs list [--query walk] [--kind anims|packs|characters]
//   node scripts/mixamo-fetch.mjs anims Walking "Standing Idle" | --query swim | --all
//   node scripts/mixamo-fetch.mjs characters "Y Bot" | --query knight | --all
//
// What the API looks like is taken from the community tools (mixamo_anims_downloader, the
// Python "Mixamo Downloader") and is Adobe's to change without notice: when an export starts
// failing, compare buildExport() with what the page sends in DevTools' network tab.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const API = 'https://www.mixamo.com/api/v1';
// The page sends this on every call; without it the API answers 403.
const API_KEY = 'mixamo2';
export const DEFAULT_OUT = process.env.MIXAMO_OUT || 'D:\\Mixamo';
// Our bake expects Mixamo's own skeleton; Y Bot and X Bot carry it unchanged (mixamo-clips skill).
export const DEFAULT_CHARACTER = 'Y Bot';
const KINDS = { anims: 'Motion', packs: 'MotionPack', characters: 'Character' };

// FBX Binary, no skin, 30 fps, no keyframe reduction; In Place off unless asked, because the
// bake reads a gait's stride from how far the hips travel and refuses an In Place walk.
export const ANIM_PREFS = { format: 'fbx7', skin: 'false', fps: '30', reducekf: '0' };
export const CHARACTER_PREFS = { format: 'fbx7', skin: 'true', mesh: 't-pose' };

export function slug(s) {
  return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';
}

// A token pasted from DevTools arrives as "Bearer x", in quotes, or with a newline.
export function cleanToken(raw) {
  return String(raw || '').trim().replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '').trim();
}

export function readToken({ tokenFile, env = process.env } = {}) {
  if (env.MIXAMO_TOKEN) return cleanToken(env.MIXAMO_TOKEN);
  try { return cleanToken(fs.readFileSync(tokenFile, 'utf8')); } catch { return ''; }
}

// The export body, the one place to compare with what mixamo.com sends.
export function buildExport({ character, product, gmsHash, prefs = ANIM_PREFS, inplace = false }) {
  if (product.type === 'Character') {
    return { character_id: character.id, product_name: product.name, type: 'Character',
      preferences: { ...CHARACTER_PREFS, format: prefs.format || CHARACTER_PREFS.format }, gms_hash: null };
  }
  if (!gmsHash) throw new Error(`no gms_hash for ${product.name}`);
  // The page sends the clip's parameters as one comma-separated string of their values.
  const params = Array.isArray(gmsHash.params) ? gmsHash.params.map((p) => (Array.isArray(p) ? p[1] : p)).join(',') : gmsHash.params;
  return {
    character_id: character.id,
    product_name: product.name,
    type: 'Motion',
    preferences: { ...prefs, inplace: String(inplace) },
    gms_hash: [{ ...gmsHash, params, inplace: Boolean(inplace) }],
  };
}

export function manifestOf({ product, character, prefs, inplace, file, bytes, at }) {
  return {
    name: product.name,
    id: product.id,
    type: product.type,
    description: product.description || '',
    character: product.type === 'Character' ? null : { id: character.id, name: character.name },
    settings: product.type === 'Character' ? { ...CHARACTER_PREFS, format: prefs.format } : { ...prefs, inplace },
    file,
    bytes,
    downloadedAt: at,
    source: 'mixamo.com',
  };
}

// Where a product lands: its name, lower case with dashes as the skill wants, and the id's
// first eight characters only when another product already took that name (Mixamo has a
// dozen "Walking"s). The index makes that stable across runs.
export function fileFor(index, product, ext = '.fbx') {
  if (index[product.id]) return index[product.id];
  const taken = new Set(Object.values(index));
  const base = slug(product.name);
  const plain = base + ext;
  return taken.has(plain) ? `${base}-${product.id.slice(0, 8)}${ext}` : plain;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createClient({ token, fetch = globalThis.fetch, delay = 1500, retries = 6, log = () => {}, wait = sleep }) {
  if (!token) throw new Error('no token: set MIXAMO_TOKEN or fill the token file (README.md, "Mixamo in bulk")');
  let last = 0;
  async function pace() {
    const left = last + delay - Date.now();
    if (left > 0) await wait(left);
    last = Date.now();
  }
  async function call(method, url, body) {
    for (let attempt = 0; ; attempt++) {
      await pace();
      const res = await fetch(url.startsWith('http') ? url : API + url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'X-Api-Key': API_KEY, Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error(`mixamo.com says ${res.status}: the token has expired or is not yours - take a fresh one from DevTools`);
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const after = Number(res.headers?.get?.('retry-after'));
        const ms = Number.isFinite(after) && after > 0 ? after * 1000 : Math.min(60000, 2000 * 2 ** attempt);
        log(`  ${res.status}, waiting ${Math.round(ms / 1000)} s (attempt ${attempt + 1}/${retries})`);
        await wait(ms);
        continue;
      }
      if (!res.ok) throw new Error(`${method} ${url.split('?')[0]} -> ${res.status} ${await res.text().catch(() => '')}`.slice(0, 400));
      return res.json();
    }
  }
  return {
    async search({ kind = 'anims', query = '', limit = Infinity } = {}) {
      const type = Array.isArray(kind) ? kind.map((k) => KINDS[k]).join(',') : KINDS[kind];
      const out = [];
      for (let page = 1; ; page++) {
        const q = new URLSearchParams({ page: String(page), limit: '96', order: '', type, query });
        const json = await call('GET', `/products?${q}`);
        out.push(...(json.results || []));
        const pages = json.pagination?.num_pages ?? 1;
        if (page >= pages || out.length >= limit || !(json.results || []).length) break;
      }
      return out.slice(0, limit);
    },
    product: (id, characterId) => call('GET', `/products/${id}?similar=0&character_id=${characterId}`),
    export: (body) => call('POST', '/animations/export', body),
    monitor: (characterId) => call('GET', `/characters/${characterId}/monitor`),
    // The job's result is a signed storage URL: fetched bare, since a bearer header breaks it.
    async download(url) {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(url);
        if ((res.status === 429 || res.status >= 500) && attempt < retries) { await wait(Math.min(60000, 2000 * 2 ** attempt)); continue; }
        if (!res.ok) throw new Error(`download -> ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      }
    },
    wait,
  };
}

// An export is a job on the character: ask the monitor until it has a file.
export async function awaitJob(client, characterId, { every = 2000, timeout = 300000 } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const m = await client.monitor(characterId);
    if (m.status === 'completed' && m.job_result) return m.job_result;
    if (m.status === 'failed') throw new Error(`export failed: ${m.message || 'no reason given'}`);
    if (Date.now() > until) throw new Error('export did not finish in time');
    await client.wait(every);
  }
}

export async function findCharacter(client, { name = DEFAULT_CHARACTER, id } = {}) {
  if (id) return { id, name: name || id };
  const hits = await client.search({ kind: 'characters', query: name });
  const hit = hits.find((h) => h.name.toLowerCase() === name.toLowerCase());
  if (!hit) throw new Error(`no character called "${name}" (found: ${hits.slice(0, 8).map((h) => h.name).join(', ') || 'nothing'})`);
  return { id: hit.id, name: hit.name };
}

function readIndex(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')); } catch { return {}; }
}

function writeAtomic(file, data) {
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// Exports and saves each product in turn - one at a time, because the monitor is per character
// and a second export would overwrite the first's job. A product already on disk is skipped,
// so a run that was stopped picks up where it was.
export async function fetchAll(client, products, { dir, character, prefs = ANIM_PREFS, inplace = false, dryRun = false,
  log = console.log, now = () => new Date().toISOString() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const index = readIndex(dir);
  const done = { fetched: 0, skipped: 0, failed: [] };
  for (const [i, product] of products.entries()) {
    const file = fileFor(index, product);
    const at = `[${i + 1}/${products.length}] ${product.name}`;
    if (fs.existsSync(path.join(dir, file))) { done.skipped++; log(`${at}: have ${file}`); continue; }
    if (product.type === 'MotionPack') { done.failed.push({ name: product.name, why: 'a pack: fetch its motions one by one' }); log(`${at}: skipped, a pack`); continue; }
    if (dryRun) { log(`${at}: would fetch -> ${file}`); continue; }
    try {
      let gmsHash = null;
      if (product.type !== 'Character') {
        const details = await client.product(product.id, character.id);
        gmsHash = details.details?.gms_hash;
      }
      const owner = product.type === 'Character' ? { id: product.id, name: product.name } : character;
      await client.export(buildExport({ character: owner, product, gmsHash, prefs, inplace }));
      const url = await awaitJob(client, owner.id);
      const bytes = await client.download(url);
      writeAtomic(path.join(dir, file), bytes);
      index[product.id] = file;
      writeAtomic(path.join(dir, 'index.json'), JSON.stringify(index, null, 2));
      const manifest = manifestOf({ product, character, prefs, inplace, file, bytes: bytes.length, at: now() });
      writeAtomic(path.join(dir, file.replace(/\.fbx$/, '.json')), JSON.stringify(manifest, null, 2));
      done.fetched++;
      log(`${at}: ${file} (${Math.round(bytes.length / 1024)} kB)`);
    } catch (e) {
      if (/token/.test(e.message)) throw e;
      done.failed.push({ name: product.name, why: e.message });
      log(`${at}: FAILED - ${e.message}`);
    }
  }
  return done;
}

export function parseArgs(argv) {
  const opts = { _: [] };
  const flags = new Set(['all', 'inplace', 'dry-run', 'json', 'every-match']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { opts._.push(a); continue; }
    const key = a.slice(2);
    if (flags.has(key)) opts[key] = true;
    else opts[key] = argv[++i];
  }
  return opts;
}

// Names given on the command line: an exact (case-blind) match of Mixamo's name, the first
// one Mixamo lists unless --every-match; `id:<uuid>` names one product outright.
async function byNames(client, kind, names, every) {
  const out = [];
  for (const name of names) {
    if (name.startsWith('id:')) { out.push({ id: name.slice(3), name: name.slice(3), type: KINDS[kind] }); continue; }
    const hits = (await client.search({ kind, query: name })).filter((h) => h.name.toLowerCase() === name.toLowerCase());
    if (!hits.length) console.log(`  no ${kind === 'characters' ? 'character' : 'animation'} called "${name}"`);
    out.push(...(every ? hits : hits.slice(0, 1)));
  }
  return out;
}

const USAGE = `node scripts/mixamo-fetch.mjs <list|anims|characters> [names...] [options]
  --query <q>          search instead of exact names
  --all                everything of that kind
  --kind <k>           list only: anims (default), packs, characters
  --character <name>   anims are exported on this character (default "${DEFAULT_CHARACTER}")
  --character-id <id>  ... or on this id
  --inplace            In Place on (leave it off for walk, run, sprint)
  --fps <n>            default 30
  --format <f>         default fbx7 (FBX Binary)
  --out <dir>          default ${DEFAULT_OUT} (or MIXAMO_OUT)
  --token-file <file>  default <out>/token.txt (MIXAMO_TOKEN wins)
  --delay <ms>         pause between requests, default 1500
  --max <n>            stop after n products
  --every-match        a name takes every product with that name, not only the first
  --dry-run            say what would be fetched, fetch nothing`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const mode = opts._.shift();
  if (!['list', 'anims', 'characters'].includes(mode)) { console.log(USAGE); process.exit(mode ? 1 : 0); }
  const out = opts.out || DEFAULT_OUT;
  const token = readToken({ tokenFile: opts['token-file'] || path.join(out, 'token.txt') });
  const client = createClient({ token, delay: Number(opts.delay ?? 1500), log: console.log });
  const max = opts.max ? Number(opts.max) : Infinity;

  if (mode === 'list') {
    const hits = await client.search({ kind: opts.kind || 'anims', query: opts.query || opts._.join(' '), limit: max });
    if (opts.json) console.log(JSON.stringify(hits.map(({ id, name, type, description }) => ({ id, name, type, description })), null, 2));
    else for (const h of hits) console.log(`${h.id}  ${h.type.padEnd(10)}  ${h.name}${h.description && h.description !== h.name ? `  - ${h.description}` : ''}`);
    console.log(`${hits.length} found`);
    return;
  }

  const kind = mode;
  let products;
  if (opts.all || opts.query) products = await client.search({ kind, query: opts.query || '', limit: max });
  else if (opts._.length) products = (await byNames(client, kind, opts._, opts['every-match'])).slice(0, max);
  else { console.log(USAGE); process.exit(1); }

  const prefs = { ...ANIM_PREFS, fps: String(opts.fps || ANIM_PREFS.fps), format: opts.format || ANIM_PREFS.format };
  let character = null;
  let dir = path.join(out, 'characters');
  if (kind === 'anims') {
    character = await findCharacter(client, { name: opts.character || DEFAULT_CHARACTER, id: opts['character-id'] });
    dir = path.join(out, 'anims', slug(character.name));
    console.log(`on ${character.name} (${character.id}) -> ${dir}`);
  }
  const done = await fetchAll(client, products, { dir, character, prefs, inplace: !!opts.inplace, dryRun: !!opts['dry-run'] });
  console.log(`fetched ${done.fetched}, already had ${done.skipped}, failed ${done.failed.length}`);
  for (const f of done.failed) console.log(`  ${f.name}: ${f.why}`);
  if (done.failed.length) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
