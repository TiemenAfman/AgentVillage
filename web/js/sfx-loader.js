// The keeper's own recordings (Plans/meer-geluiden.md, phase 9; HOME/audio/sfx, named by
// shared/sfx.mjs, served by lib/sfx.mjs): fetched and decoded here, handed to sound.js ready
// (`setSamples`), so sound.js itself still fetches and decodes nothing.
//
// The imp's and the HD pack's rules: nothing before the boot is done (main.js calls `refresh`
// only after `state.ui.boot(true)`), nothing awaits any of it, and a failure is said once. And
// nothing is loaded that is not within earshot: a family is asked for only once sound.js has
// wanted it (`sound.wanted()` - the families it has needed so far), which is the same moment
// it would have started computing its own. A page with no islander (the phone, the web) asks
// the islander nothing, and takes only the island's own recordings (`defaults`).
//
// Everything that touches the outside comes in as a function - `list`, `bytes`, `decode` - so
// tests/sfx-loader.test.mjs runs it under Node on fakes.
//
// `defaults` are the island's own recordings, committed in web/audio (island-sfx.js: the taverns'
// chatter, CC0), `{ family: [urls] }`, fetched with `fetchDefault`: what a family plays when the
// keeper has put no file of their own in for it - and on every page with no islander at all (the
// phone, the web), which hands in a `list` that answers nothing.
export function createSfxLoader({ sound, list, bytes, decode, log = () => {}, defaults = {}, fetchDefault = null }) {
  let files = null;              // { family: [names] } from the islander, null until asked
  const done = new Map();        // family -> the key it was loaded from (sourceOf), or 'busy'
  let told = false;

  // Where a family's recordings come from now: the keeper's files, else the island's own, else
  // nowhere. `key` tells one source from another, so a change of either is loaded again.
  function sourceOf(family) {
    const own = files && files[family];
    if (own && own.length) return { names: own, get: bytes, key: own.join('\n') };
    const ours = fetchDefault && defaults[family];
    if (ours && ours.length) return { names: ours, get: fetchDefault, key: `default:${ours.join('\n')}` };
    return null;
  }

  // Ask the islander what is in the folder again. A family whose files changed is loaded again
  // the next time it is wanted; one whose files are gone goes back to its computed voice.
  async function refresh() {
    let next;
    try { next = await list(); } catch { next = null; }
    if (!next || typeof next !== 'object') {
      // No answer (a visitor is refused the list): the island's own recordings all the same, the
      // first time; after that whatever was heard last stands.
      if (files === null) { files = {}; tick(); }
      return;
    }
    files = {};
    for (const [family, names] of Object.entries(next)) {
      if (Array.isArray(names) && names.length) files[family] = names.filter((n) => typeof n === 'string');
    }
    for (const [family, was] of [...done]) {
      if (was === 'busy') continue;
      const now = sourceOf(family);
      if (now && now.key === was) continue;
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
      const from = sourceOf(family);
      if (!from || done.has(family)) continue;
      load(ctx, family, from);
    }
  }

  async function load(ctx, family, { names, get, key }) {
    done.set(family, 'busy');
    const buffers = [];
    for (const name of names) {
      try {
        buffers.push(await decode(ctx, await get(name)));
      } catch (e) {
        if (!told) { told = true; log(`[sfx] ${name} could not be played (${e && e.message ? e.message : e}); the island's own sound stays`); }
      }
    }
    done.set(family, key);
    if (buffers.length) sound.setSamples(family, buffers);
  }

  return { refresh, tick, loaded: () => [...done].filter(([, v]) => v !== 'busy').map(([k]) => k) };
}
