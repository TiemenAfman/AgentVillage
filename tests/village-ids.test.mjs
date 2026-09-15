// A session that starts in a git worktree gets filed under two project slugs - the
// worktree's own and the one of the repository it hangs under - and both folders keep a
// copy of the same `agent-<id>.jsonl` sidecars. Every building on the island is
// addressed by its id, so one apprentice discovered twice would put two sheds on one
// plot, count double in the stats and shift the milestones.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discover } from '../lib/sources.mjs';
import { parseIncremental } from '../lib/parse.mjs';
import { fileKey } from '../lib/cache.mjs';
import { buildVillage } from '../lib/village.mjs';

const SESSION = 'c9c05470-d5b2-4421-9705-8afff748a62a';
const SHARED = ['a0dee958f0a95d0a3', 'a78f0b397dc840d01'];   // in both project folders
const PARENT_ONLY = 'a739105413904c469';                     // only where the session ended up
const START = Date.parse('2026-09-10T09:00:00Z');

function jsonl(lines) {
  return lines.map((o) => `${JSON.stringify(o)}\n`).join('');
}

function transcript(cwd, turns) {
  const lines = [{
    type: 'user', timestamp: new Date(START).toISOString(), cwd,
    origin: { kind: 'human' }, message: { content: 'Meet de kant van de plaat' },
  }];
  for (let i = 0; i < turns; i++) {
    lines.push({
      type: 'assistant', timestamp: new Date(START + i * 1000).toISOString(), cwd,
      message: {
        id: `msg_${i}`, model: 'claude-opus-5', usage: { output_tokens: 20 },
        content: [{ type: 'tool_use', name: 'Read', input: {} }],
      },
    });
  }
  return jsonl(lines);
}

// One project folder: the session's transcript plus a sidecar per apprentice, all
// stamped with the same mtime so "which copy is newer" is the folder's, not the file's.
function plant(home, { slug, cwd, agents, at }) {
  const dir = path.join(home, 'projects', slug);
  const subagents = path.join(dir, SESSION, 'subagents');
  fs.mkdirSync(subagents, { recursive: true });
  const files = [path.join(dir, `${SESSION}.jsonl`)];
  fs.writeFileSync(files[0], transcript(cwd, 4));
  for (const id of agents) {
    const file = path.join(subagents, `agent-${id}.jsonl`);
    fs.writeFileSync(file, transcript(cwd, 2));
    files.push(file);
  }
  for (const f of files) fs.utimesSync(f, at / 1000, at / 1000);
}

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'settlers-ids-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const cwd = path.join(home, 'work', 'kantmeting');
  plant(home, {
    slug: 'D--git-Sybolt-PLC--claude-worktrees-kantmeting-tool',
    cwd: path.join(cwd, '.claude', 'worktrees', 'kantmeting-tool'),
    agents: SHARED, at: START,
  });
  plant(home, {
    slug: 'D--git-Sybolt-PLC', cwd, agents: [...SHARED, PARENT_ONLY], at: START + 60000,
  });
  return discover({ claudeHome: home, desktopDir: path.join(home, 'no-desktop') });
}

async function village(sources) {
  const cache = { files: {}, repoRoots: {} };
  for (const f of [...sources.transcripts, ...sources.subagents]) {
    const { entry } = await parseIncremental(f.file, f.sessionId, null);
    cache.files[fileKey(f.file)] = entry;
  }
  // The fixture lives in the temp folder, which the island excludes by default: a
  // session working out of there is not a project. Here it is just where the test sits.
  const config = { excludeCwd: [] };
  return buildVillage({ sources, cache, arrivals: [], config, now: START + 600000 });
}

test('an apprentice filed under two project folders is discovered once', (t) => {
  const sources = fixture(t);
  const keys = sources.subagents.map((s) => `${s.sessionId}:${s.agentId}`);
  assert.deepEqual([...keys].sort(), [...SHARED, PARENT_ONLY].sort().map((id) => `${SESSION}:${id}`));
  // Of the two copies, the one the session kept appending to.
  for (const s of sources.subagents) {
    assert.ok(!s.file.includes('worktrees'), `kept the stale copy: ${s.file}`);
  }
});

test('every building in the village has its own id', async (t) => {
  const sources = fixture(t);
  const model = await village(sources);
  const ids = model.buildings.map((b) => b.id);
  const seen = new Set();
  const twice = [];
  for (const id of ids) {
    if (seen.has(id)) twice.push(id); else seen.add(id);
  }
  assert.deepEqual(twice, [], `duplicate building ids: ${twice.join(', ')}`);
  assert.equal(model.stats.apprentices, 3);
  assert.equal(model.buildings.filter((b) => b.kind === 'shed').length, 3);
});
