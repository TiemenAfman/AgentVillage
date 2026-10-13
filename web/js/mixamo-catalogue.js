// The Mixamo catalogue of the motion workbench (/avatar-motion.html): every clip of the keeper's own
// library (scripts/mixamo-fetch.mjs -> D:\Mixamo\anims\y-bot, served keeper-only by /api/mixamo,
// lib/mixamo.mjs) to search, filter, play on our own bodies, and star - and the starred ones handed
// out in assets/mixamo/clips.json's shape, for a bake to be made of them. Nothing here is baked: the
// game still plays only what scripts/bake-mixamo-gait.py wrote into gait-clips.js.
//
// A clip is loaded as an FBX with three's FBXLoader, imported dynamically on the first play (this
// page only - the island never loads an FBX), turned into a baked clip's shape by mixamo-preview.js
// and handed to the rig as `pose.preview`. That is the bake's conversion for a clip played by time,
// so what is seen is close; the bake's per-kind corrections (a gait's stride, a climb's rise, the
// swim's lean) come only with the bake.
import { mine } from './api.js';
import { previewClip } from './mixamo-preview.js';

const FAVOURITES = 'promptholm.mixamo.favourites';
const SECONDS = 'promptholm.mixamo.seconds';
const ROW = 30;
const KEEP = 24;   // clips kept converted, the most recently played

// Categories by the words in a clip's name and description (the manifest's). A clip may be in several.
export const CATEGORIES = [
  ['climb', 'Klimmen', /climb|ladder|wall run|scal/],
  ['hang', 'Hangen', /hang|braced|shimmy|dangl/],
  ['sit', 'Zitten', /\bsit|seat|chair|bench|sitting/],
  ['idle', 'Stilstaan', /idle|standing(?! up)|breath/],
  ['walk', 'Lopen/rennen', /walk|run|jog|sprint|strafe|turn/],
  ['jump', 'Springen', /jump|leap|fall|land|vault|flip|hop/],
  ['dance', 'Dansen', /danc|samba|salsa|hip ?hop|twerk|break ?dance|shuffle|tango|rumba|chicken|thriller|macarena|gangnam|robot|bboy|tut/],
  ['fight', 'Vechten', /punch|kick|fight|box|attack|block|combo|jab|uppercut|knock|hook|brawl|parry|dodge|hit|react|stab|slash|strike/],
  ['sword', 'Zwaard', /sword|katana|blade|slash|great ?sword|sheath|unsheath|1h|2h|two ?hand/],
  ['swim', 'Zwemmen', /swim|tread|dive|diving|water|drown|float/],
  ['death', 'Dood', /death|dying|\bdie|dead|killed/],
  ['emote', 'Emotes', /wave|waving|cheer|clap|bow|salute|nod|shak|laugh|cry|angry|happy|sad|taunt|talk|point|thumb|yell|victory|celebrat|thank|greet|agree|shrug|excited|surprise|pray|kiss|blow/],
  ['carry', 'Dragen', /carry|lift|push|pull|drag|pick ?up|put ?down|box|crate/],
  ['work', 'Werken', /dig|hammer|chop|mining|shovel|work|build|repair|saw|plant|farm|pick ?axe|sweep|wipe|typ/],
  ['crouch', 'Bukken', /crouch|sneak|crawl|prone|kneel|squat/],
  ['fish', 'Vissen', /fish|cast|reel/],
  ['ship', 'Schip', /row|sail|paddle|rope|crank|wheel|steer|cannon|lever|pull|swab|anchor|pirate/],
];

export function categoriesOf(clip) {
  const words = `${clip.name} ${clip.description || ''}`.toLowerCase();
  return CATEGORIES.filter(([, , re]) => re.test(words)).map(([id]) => id);
}

// A key for assets/mixamo/clips.json: the clip's name in camelCase, letters and digits only
// ("Standing Idle" -> standingIdle), numbered when two would collide.
export function clipKey(name, taken = new Set()) {
  const words = String(name).replace(/[^a-z0-9]+/gi, ' ').trim().split(/\s+/).filter(Boolean);
  let key = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') || 'clip';
  if (/^\d/.test(key)) key = 'clip' + key;
  let k = key, n = 2;
  while (taken.has(k)) k = key + n++;
  taken.add(k);
  return k;
}

// The starred clips as clips.json wants them, and beside it name, file and id, for whoever bakes.
export function exportChoice(clips) {
  const taken = new Set(), out = {}, picked = [];
  for (const c of clips) {
    const key = clipKey(c.name, taken);
    out[key] = c.file;
    picked.push({ key, name: c.name, file: c.file, id: c.id });
  }
  return { clips: out, picked };
}

function readStore(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* a private window: per page only */ }
}

const CSS = `
#mixamo{position:fixed;right:20px;top:20px;bottom:20px;width:380px;display:flex;flex-direction:column;gap:8px;background:#162a25f2;border-radius:16px;padding:16px;box-shadow:0 15px 50px #0004;color:#f2e9d3;font:14px system-ui;z-index:5}
#mixamo[hidden]{display:none}
#mixamo h2{margin:0;font-size:19px;display:flex;justify-content:space-between;align-items:center}
#mixamo h2 button{font-size:13px}
#mixamo .mx-note{font-size:12px;color:#a7bcb0;line-height:1.4;margin:0}
#mixamo input[type=search]{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid #8ba699;background:#0d1d19;color:#fff3d9;font:inherit}
#mixamo .mx-cats{display:flex;flex-wrap:wrap;gap:4px}
#mixamo button{border:1px solid #8ba699;background:#324f43;color:#fff3d9;border-radius:7px;padding:4px 9px;cursor:pointer;font:inherit;font-size:12.5px}
#mixamo button[aria-pressed=true]{background:#d2b575;color:#1d3028;border-color:#d2b575}
#mixamo .mx-list{flex:1;overflow-y:auto;position:relative;border-radius:8px;background:#0d1d1980;min-height:120px}
#mixamo .mx-row{position:absolute;left:0;right:0;height:${ROW}px;display:flex;align-items:center;gap:6px;padding:0 8px;box-sizing:border-box;cursor:pointer;white-space:nowrap}
#mixamo .mx-row:hover{background:#ffffff10}
#mixamo .mx-row.on{background:#d2b57540}
#mixamo .mx-row span.n{flex:1;overflow:hidden;text-overflow:ellipsis}
#mixamo .mx-row em{color:#a7bcb0;font-style:normal;font-size:12px}
#mixamo .mx-row small{color:#a7bcb0;font-size:11.5px}
#mixamo .mx-star{border:0;background:none;padding:0 2px;font-size:17px;color:#8ba699;cursor:pointer}
#mixamo .mx-star.on{color:#f0c75a}
#mixamo .mx-play{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
#mixamo .mx-play label{font-size:12.5px;display:flex;gap:4px;align-items:center}
#mixamo select{background:#0d1d19;color:#fff3d9;border:1px solid #8ba699;border-radius:6px;font:inherit;font-size:12.5px}
#mixamo input[type=range]{width:100%}
#mixamo .mx-now{font-size:13px;min-height:1.3em}
#mixamo textarea{width:100%;box-sizing:border-box;height:160px;background:#0d1d19;color:#fff3d9;border:1px solid #8ba699;border-radius:8px;font:12px ui-monospace,monospace}
`;

// bodies: [{ id, name }] the bodies a clip may be played on (those that play clips).
export function createMixamoCatalogue({ bodies, parent = document.body }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('aside');
  root.id = 'mixamo'; root.hidden = true;
  root.innerHTML = `
    <h2>Mixamo-catalogus <button data-mx="close">Sluiten</button></h2>
    <p class="mx-note">Je eigen bibliotheek (Y Bot), op ons eigen lijf. Een benadering: de echte bake
      (scripts/bake-mixamo-gait.py) geeft het definitieve beeld, met de pas van een gang, de stijging
      van een klim en de helling van de zwemslag.</p>
    <input type="search" placeholder="Zoeken op naam…" data-mx="q">
    <div class="mx-cats" data-mx="cats"></div>
    <div class="mx-list" data-mx="list"><div data-mx="spacer"></div></div>
    <div class="mx-now" data-mx="now">Kies een clip.</div>
    <input type="range" min="0" max="1" step="0.001" value="0" data-mx="scrub">
    <div class="mx-play">
      <button data-mx="pause">Pauze</button>
      <label><input type="checkbox" data-mx="loop" checked> Herhalen</label>
      <label>Snelheid <select data-mx="speed">${[0.25, 0.5, 1, 1.5, 2].map((s) => `<option value="${s}"${s === 1 ? ' selected' : ''}>${s}×</option>`).join('')}</select></label>
      <label><input type="checkbox" data-mx="inplace" checked> Op de plek</label>
      <label>Lijf <select data-mx="body">${bodies.map((b, i) => `<option value="${i}">${b.name}</option>`).join('')}</select></label>
    </div>
    <div class="mx-play"><button data-mx="export">Exporteer keuze (<span data-mx="count">0</span>)</button><button data-mx="stop">Stoppen</button></div>
    <textarea data-mx="out" hidden readonly></textarea>`;
  parent.appendChild(root);
  const $ = (k) => root.querySelector(`[data-mx="${k}"]`);

  let all = [], shown = [], cat = null, query = '', current = null, loading = null;
  let favourites = new Set(readStore(FAVOURITES, []));
  const seconds = readStore(SECONDS, {});
  let t = 0, paused = false;
  const converted = new Map();

  $('cats').innerHTML = [['fav', '★ Favorieten'], ...CATEGORIES.map(([id, label]) => [id, label])]
    .map(([id, label]) => `<button data-cat="${id}" aria-pressed="false">${label}</button>`).join('');
  $('cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    cat = cat === b.dataset.cat ? null : b.dataset.cat;
    for (const x of $('cats').children) x.setAttribute('aria-pressed', String(x.dataset.cat === cat));
    filter();
  });
  $('q').addEventListener('input', () => { query = $('q').value.trim().toLowerCase(); filter(); });
  $('close').onclick = () => { root.hidden = true; };
  $('stop').onclick = () => { current = null; $('now').textContent = 'Kies een clip.'; draw(); };
  $('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? 'Afspelen' : 'Pauze'; };
  $('scrub').addEventListener('input', () => { if (current) { t = Number($('scrub').value) * current.clip.seconds; paused = true; $('pause').textContent = 'Afspelen'; } });
  $('export').onclick = () => {
    const chosen = all.filter((c) => favourites.has(c.file));
    const text = JSON.stringify(exportChoice(chosen), null, 2);
    const out = $('out');
    out.hidden = false; out.value = text; out.select();
    navigator.clipboard?.writeText(text).catch(() => {});
  };
  addEventListener('keydown', (e) => {
    if (root.hidden || e.target.closest('input,select,textarea') || e.key !== ' ') return;
    e.preventDefault(); $('pause').click();
  });

  const list = $('list'), spacer = $('spacer');
  list.addEventListener('scroll', draw);
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.mx-row');
    if (!row) return;
    const clip = shown[Number(row.dataset.i)];
    if (e.target.closest('.mx-star')) {
      if (favourites.has(clip.file)) favourites.delete(clip.file); else favourites.add(clip.file);
      writeStore(FAVOURITES, [...favourites]);
      if (cat === 'fav') filter(); else draw();
      count();
      return;
    }
    play(clip);
  });

  function count() { $('count').textContent = String(all.filter((c) => favourites.has(c.file)).length); }

  function filter() {
    shown = all.filter((c) => (!query || c.words.includes(query))
      && (!cat || (cat === 'fav' ? favourites.has(c.file) : c.cats.includes(cat))));
    // "walking" finds Walking first, then what begins with it, then the rest (each kept in name order)
    if (query) {
      const rank = (c) => { const n = c.name.toLowerCase(); return n === query ? 0 : n.startsWith(query) ? 1 : 2; };
      shown = shown.map((c, i) => [rank(c), i, c]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
    }
    spacer.style.height = `${shown.length * ROW}px`;
    list.scrollTop = 0;
    draw();
  }

  // Only the rows in view (and a few either side) exist: 2419 of them did not need to.
  function draw() {
    const from = Math.max(0, Math.floor(list.scrollTop / ROW) - 4);
    const to = Math.min(shown.length, Math.ceil((list.scrollTop + list.clientHeight) / ROW) + 4);
    for (const r of [...list.querySelectorAll('.mx-row')]) r.remove();
    const frag = document.createDocumentFragment();
    for (let i = from; i < to; i++) {
      const c = shown[i], row = document.createElement('div');
      row.className = 'mx-row' + (current && current.file === c.file ? ' on' : '');
      row.dataset.i = String(i);
      row.style.top = `${i * ROW}px`;
      const s = seconds[c.file];
      row.innerHTML = `<button class="mx-star${favourites.has(c.file) ? ' on' : ''}" title="Favoriet">${favourites.has(c.file) ? '★' : '☆'}</button><span class="n"></span><small>${s ? s.toFixed(1) + ' s' : ''}</small>`;
      // Many clips share a name (two dozen are "Walking"); the manifest's description tells them apart.
      const n = row.querySelector('.n');
      n.textContent = c.name;
      if (c.description && c.description.toLowerCase() !== c.name.toLowerCase()) {
        const d = document.createElement('em'); d.textContent = ` · ${c.description}`; n.appendChild(d);
      }
      row.title = `${c.name}${c.description ? ' — ' + c.description : ''}\n${c.file}`;
      frag.appendChild(row);
    }
    list.appendChild(frag);
  }

  async function play(clip) {
    loading = clip.file;
    $('now').textContent = `${clip.name} · laden…`;
    try {
      let conv = converted.get(clip.file);
      if (!conv) {
        const [{ FBXLoader }, res] = await Promise.all([import('three/addons/loaders/FBXLoader.js'), mine(`/api/mixamo/${encodeURIComponent(clip.file)}`)]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const fbx = new FBXLoader().parse(await res.arrayBuffer(), '');
        if (!fbx.animations.length) throw new Error('geen animatie in het bestand');
        conv = previewClip(fbx, fbx.animations[0], { source: clip.file });
        converted.set(clip.file, conv);
        while (converted.size > KEEP) converted.delete(converted.keys().next().value);
      }
      if (loading !== clip.file) return;
      seconds[clip.file] = conv.seconds;
      writeStore(SECONDS, seconds);
      current = { file: clip.file, name: clip.name, clip: conv };
      t = 0;
      $('now').textContent = `${clip.name} · ${conv.seconds.toFixed(2)} s${clip.description ? ' · ' + clip.description : ''}`;
      draw();
    } catch (e) {
      if (loading === clip.file) $('now').textContent = `${clip.name} · niet te laden: ${e.message}`;
    }
  }

  async function load() {
    try {
      const res = await mine('/api/mixamo');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { clips, missing } = await res.json();
      all = clips.map((c) => ({ ...c, cats: categoriesOf(c), words: `${c.name} ${c.description} ${c.file}`.toLowerCase() }));
      if (missing || !all.length) $('now').textContent = 'Geen bibliotheek gevonden (config mixamo.dir, MIXAMO_OUT of D:\\Mixamo).';
      count();
      filter();
    } catch (e) {
      $('now').textContent = `De bibliotheek is niet te lezen: ${e.message}`;
    }
  }

  return {
    open() {
      root.hidden = false;
      if (!all.length) load(); else draw();
    },
    toggle() { if (root.hidden) this.open(); else root.hidden = true; },
    // This frame's trial, or null: which body, the clip and where in it, and how far the hips have
    // gone over the floor (in hip heights, [x, z]) unless In Place is on.
    frame(dt) {
      if (root.hidden || !current) return null;
      const C = current.clip, n = C.rows.length;
      if (!paused) {
        t += dt * Number($('speed').value);
        if (t > C.seconds) t = $('loop').checked ? t % C.seconds : C.seconds;
      }
      const f = Math.max(0, Math.min(1, t / C.seconds));
      if (document.activeElement !== $('scrub')) $('scrub').value = String(f);
      const x = f * (n - 1), i = Math.min(n - 2, Math.floor(x)), k = x - i;
      const a = C.travel[i], b = C.travel[i + 1] || a;
      const travel = $('inplace').checked ? [0, 0] : [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      return { body: Number($('body').value), clip: C, u: f * (n - 1) / n, travel, name: current.name };
    },
  };
}
