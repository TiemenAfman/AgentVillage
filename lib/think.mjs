// A thought, had while standing somewhere on the island.
//
// Press T on foot and whatever you type goes to a Claude session started in this
// repository - the island's own code, which is also the island. So a question about
// the place can be answered by reading it, and "build a bridge here" can be done by
// putting one there.
//
// This is the same shape as lib/chat.mjs: attached, not detached, streaming
// newline-delimited JSON straight through to the page, and dying with the request.
// The difference is who you are talking to. A settler is a session that already
// exists somewhere else on the machine; this one lives here, and knows where you
// are standing.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ROOT, loadConfig } from './paths.mjs';
import { resolveClaude } from './dispatch.mjs';
import { catalogueLines } from '../shared/shapes.mjs';

const UUID = /^[0-9a-f-]{36}$/i;
const MODEL_OK = /^claude-[a-z0-9.-]+$/;

// What the thinker is told, before the question. It gets the ground it is standing on
// and the one command line it needs; everything else it can read, because the island
// is the repository it has been started in.
export function thinkPrompt({ text, at, island }) {
  const here = at
    ? `They are on foot at x ${at.x}, z ${at.z}, on ground ${at.y ?? 0} high${at.near ? `, beside ${at.near}` : ''}.`
    : 'They are somewhere on the island; run `node tools/island.mjs where` to find out where.';

  return [
    `You are being spoken to by someone standing on ${island}, the island this repository draws.`,
    here,
    '',
    'They said:',
    '',
    String(text).trim(),
    '',
    '---',
    '',
    'The island in one breath: this repository is both the code and the place. A Node',
    'server on http://localhost:4747 serves a three.js page, and the village on it is',
    'regenerated from Claude session transcripts on every scan - so nothing written into',
    'data/village.json survives. Anything put there on purpose lives in data/props.json',
    'and is placed with the island\'s own command line, from the repository root:',
    '',
    '  node tools/island.mjs where                          where they are standing now',
    '  node tools/island.mjs look                           what stands nearby, and where',
    '  node tools/island.mjs kinds                          what can be built',
    '  node tools/island.mjs build tree --at 12.5,-3.2',
    '  node tools/island.mjs build bridge --at 4,18 --rot 1.57 --length 7',
    '  node tools/island.mjs list',
    '  node tools/island.mjs remove prop:1a2b3c4d',
    '',
    'What it will build today:',
    ...catalogueLines(),
    '',
    'Coordinates are world units: x runs east, z runs south, the origin is the middle of',
    'the island, and the land ends around 40 out. One unit is one grid cell, about the',
    'width of a footpath. "Here" is where they are standing - put it a step or two away',
    'rather than on top of them. --rot is radians, and turns a bridge or a fence to face',
    'the way you want it to run.',
    '',
    'Ask `look` before you place anything that has to relate to something already there.',
    'It gives you every building and prop nearby with its coordinates, which is faster and',
    'more reliable than working the grid out of the source.',
    '',
    'The open page picks new props up within a second. Do not reload it: they are reading',
    'your answer in it. The one exception is when you have changed the page\'s own code,',
    'and then `node tools/island.mjs reload` is how you say so.',
    '',
    'If they ask for a shape the catalogue does not have, it is still placed - as a',
    'labelled cairn - so something appears either way. To do it properly, add a builder to',
    'web/js/props.js beside the others and an entry to shared/shapes.mjs; each shape is a',
    'dozen lines of boxes and cones. Then reload, and build it for real.',
    '',
    'Answer in the language they asked in, in a sentence or three. If they asked you to',
    'build something, build it and then say what you built and where. If they only asked a',
    'question, just answer it - not everything is a building.',
  ].join('\n');
}

// Starts the thinker, or carries on the one that answered last time so the
// conversation has a memory. Returns the child and the session it is holding.
export function think({ text, at = null, sessionId = null, model = null }) {
  if (!text || !String(text).trim()) throw new Error('say what you are thinking first');
  if (!fs.existsSync(ROOT)) throw new Error('the island cannot find its own repository');

  const cfg = loadConfig();
  const resume = sessionId && UUID.test(String(sessionId)) ? String(sessionId) : null;
  const id = resume || randomUUID();

  const args = resume ? ['--resume', resume] : ['--session-id', id];
  args.push(
    '--permission-mode', 'bypassPermissions',
    '--output-format', 'stream-json',
    '--verbose',
  );
  if (model && MODEL_OK.test(String(model))) args.push('--model', String(model));
  args.push('-p', thinkPrompt({ text, at, island: cfg.islandName || 'the island' }));

  const { exe, shell } = resolveClaude();
  const child = spawn(exe, args, {
    cwd: ROOT,
    windowsHide: true,
    shell,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SETTLERS_THINKING: id },
  });
  return { child, sessionId: id, resumed: !!resume, cwd: ROOT };
}
