import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverCodex, foldCodex } from '../lib/codex-sources.mjs';
import { parseIncremental } from '../lib/parse.mjs';
import { scan, filesFor } from '../scan.mjs';
import { buildBundle, parseBundle } from '../lib/islandbundle.mjs';
import { loadConfig } from '../lib/paths.mjs';

const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const row = (type, payload) => JSON.stringify({ timestamp: '2026-09-22T10:00:00Z', type, payload }) + '\n';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-island-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'sessions', '2026', '09', '22');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-2026-09-22T10-00-00-${id}.jsonl`);
  fs.writeFileSync(file, row('session_meta', { id, cwd: 'C:/CodexIslandFixture' })
    + row('turn_context', { model: 'gpt-5', cwd: 'C:/CodexIslandFixture' })
    + row('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>private context</environment_context>' }] })
    + row('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Private task title' }] })
    + row('response_item', { type: 'function_call', name: 'exec_command', arguments: 'private tool argument' })
    + row('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20 } } }));
  return { root, file };
}

test('Codex rollouts resume without double counting usage or reading incomplete lines', async t => {
  const { file } = fixture(t);
  const first = await parseIncremental(file, id, null, foldCodex);
  assert.equal(first.entry.agg.humanTurns, 1);
  assert.equal(first.entry.agg.tools.exec_command, 1);
  assert.deepEqual(first.entry.agg.tokens, { input: 60, cacheRead: 40, output: 20, cacheCreation: 0 });
  assert.ok(!JSON.stringify(first.entry).includes('private tool argument'));
  const next = row('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 150, cached_input_tokens: 50, output_tokens: 30 } } });
  fs.appendFileSync(file, next.slice(0, -1));
  const partial = await parseIncremental(file, id, first.entry, foldCodex);
  assert.equal(partial.entry.offset, first.entry.offset);
  fs.appendFileSync(file, '\n');
  const finished = await parseIncremental(file, id, partial.entry, foldCodex);
  assert.deepEqual(finished.entry.agg.tokens, { input: 100, cacheRead: 50, output: 30, cacheCreation: 0 });
  assert.equal((await parseIncremental(file, id, finished.entry, foldCodex)).changed, false);
});

test('Codex discovery includes archives once and takes desktop titles from the index', t => {
  const { root, file } = fixture(t);
  fs.mkdirSync(path.join(root, 'archived_sessions'));
  fs.copyFileSync(file, path.join(root, 'archived_sessions', path.basename(file)));
  fs.writeFileSync(path.join(root, 'session_index.jsonl'), JSON.stringify({ id, thread_name: 'Renamed task' }) + '\n{');
  const found = discoverCodex(root);
  assert.equal(found.transcripts.length, 1);
  assert.equal(found.transcripts[0].origin, 'codex');
  assert.equal(found.desktop.get(id).title, 'Renamed task');
  assert.ok(found.released.has(id));
  assert.equal(discoverCodex(path.join(root, 'absent')).transcripts.length, 0);
});

test('a Codex island has its own stable layout and a redacted publishable bundle', async t => {
  const { root } = fixture(t);
  const options = { codex: true, codexHome: root, quiet: true,
    out: path.join(root, 'village.json'), layoutFile: path.join(root, 'layout.json'), cacheFile: path.join(root, 'cache.json') };
  const result = await scan(options);
  assert.equal(result.settlers, 1);
  const layout = fs.readFileSync(options.layoutFile, 'utf8');
  await scan(options);
  assert.equal(fs.readFileSync(options.layoutFile, 'utf8'), layout);
  assert.notEqual(filesFor({ codex: true }).layout, filesFor({}).layout);
  const village = JSON.parse(fs.readFileSync(options.out));
  village.island.hostile = true;
  assert.equal(village.buildings.find(b => b.sessionId === id).source, 'codex');
  const bundle = buildBundle({ config: loadConfig(), village, id: '0123456789abcdef', keeper: 'Test keeper' });
  const text = JSON.stringify(bundle);
  assert.ok(!text.includes('Private task title'));
  assert.ok(!text.includes(id));
  assert.ok(!text.includes(root));
  assert.equal(parseBundle(bundle).island.hostile, true);
  assert.equal(parseBundle({ ...bundle, island: { ...bundle.island, hostile: 'true' } }).island.hostile, false);
});
