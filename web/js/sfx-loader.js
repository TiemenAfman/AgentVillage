// The keeper's own recordings (Plans/meer-geluiden.md, phase 9; HOME/audio/sfx, named by
// shared/sfx.mjs, served by lib/sfx.mjs): fetched and decoded here, handed to sound.js ready
// (`setSamples`), so sound.js itself still fetches and decodes nothing.
//
// The imp's and the HD pack's rules: nothing before the boot is done (main.js calls `refresh`
// only after `state.ui.boot(true)`), nothing awaits any of it, and a failure is said once. And
// nothing is loaded that is not within earshot: a family is asked for only once sound.js has
// wanted it (`sound.wanted()` - the families it has needed so far), which is the same moment
// it would have started computing its own. A page with no islander (the phone, the web) asks
// for nothing at all.
//
// Everything that touches the outside comes in as a function - `list`, `bytes`, `decode` - so
// tests/sfx-loader.test.mjs runs it under Node on fakes.
export function createSfxLoader({ sound, list, bytes, decode, log = () => {} }) {
  let files = null;              // { family: [names] } from the islander, null until asked
  const done = new Map();        // family -> the names it was loaded from (joined), or 'busy'
  let told = false;

  // Ask the islander what is in the folder again. A family whose files changed is loaded again
  // the next time it is wanted; one whose files are gone goes back to its computed voice.
  async function refresh() {
    let next;
    try { next = await list(); } catch { return; }
    if (!next || typeof next !== 'object') return;
    files = {};
    for (const [family, names] of Object.entries(next)) {
      if (Array.isArray(names) && names.length) files[family] = names.filter((n) => typeof n === 'string');
    }
    for (const [family, was] of [...done]) {
      if (was === 'busy') continue;
      const now = (files[family] || []).join('\n');
      if (now === was) continue;
      done.delete(family);
      if (!now) sound.setSamples(family, []);
    }
    tick();
  }

  // Load whatever sound.js has wanted and has files and is not loaded. Cheap when there is
  // nothing to do: main.js calls it every couple of seconds.
  function tick() {
    if (!files) return;
    const ctx = sound.context();
    if (!ctx) return;              // no graph yet: nothing is wanted either
    for (const family of sound.wanted()) {
      const names = files[family];
      if (!names || done.has(family)) continue;
      load(ctx, family, names);
    }
  }

  async function load(ctx, family, names) {
    done.set(family, 'busy');
    const key = names.join('\n');
    const buffers = [];
    for (const name of names) {
      try {
        buffers.push(await decode(ctx, await bytes(name)));
      } catch (e) {
        if (!told) { told = true; log(`[sfx] ${name} could not be played (${e && e.message ? e.message : e}); the island's own sound stays`); }
      }
    }
    done.set(family, key);
    if (buffers.length) sound.setSamples(family, buffers);
  }

  return { refresh, tick, loaded: () => [...done].filter(([, v]) => v !== 'busy').map(([k]) => k) };
}
