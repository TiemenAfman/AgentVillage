// The inventory: the one settler you steer, dressed from a screen laid out the way an RPG
// lays out what a character wears. The figure stands in a dark alcove in the middle, four
// slots down each side of it, and two dye flasks at its feet. Every slot's icon is a render
// of the very piece the rig wears (makeIcons below), not a glyph standing in for it; which
// slot owns what is inventory.js's table. Nothing is committed until you wear it - "Never
// mind" puts back what you had on.
import * as THREE from 'three';
import { SWATCHES, DEFAULT_AVATAR, CHARACTER_PICKS, SEXES, loadAvatar, saveAvatar, saveCharacter, normalizeAvatar, characterOf, pickOf } from './avatar.js';
import { createClassicAvatar } from './classic-avatar.js';
import { loadWanderers, onWanderers, wanderersReady } from './player-bodies.js';
import { INVENTORY_SLOTS, INVENTORY_FLASKS, slotIcon, optionIcon, characterIcon, dyeApplies, slotPicks, slotOffers, iconKey, iconGeometry, garmentOptions, garmentWorn, wearIn, garmentIcon, hairStyles, hairIcon } from './inventory.js';
import { openPopover, closePopover } from './popover.js';
import { WALK_SPEED } from './avatar-gait.js';
import { keyOf } from './keybinds.js';
import { byId, unlockOf } from 'shared/equipment.mjs';
import { PLAYER_SWATCHES, PLAYER_SWATCH_PARTS } from 'shared/palette.mjs';
import { isUnlocked } from './unlocks.js';

const hex = (n) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
// What a slot's dye button says it paints; the two flasks carry their own labels.
const DYE_LABEL = { hat: 'Hat colour', tunic: 'Shirt colour', hair: 'Hair colour' };
const SEX_LABEL = { male: 'Man', female: 'Woman' };
// The Wanderer portrait shows the body you would be: yours if you are one, else the woman.
const wandererOf = (spec) => `wanderer-${spec.body || 'female'}`;

export function createAvatarStudio(root, { onApply, onClose } = {}) {
  const el = document.createElement('div');
  el.className = 'handover';
  el.hidden = true;
  root.appendChild(el);

  let spec = loadAvatar();
  let snapshot = null;   // the look worn on open, restored if they back out
  let preview = null;    // the figure in the alcove, alive only while the panel is
  let icons = null;      // the slot thumbnails' renderer, likewise
  let pop = null;        // whichever picker or palette is up, if any
  let forgetBodies = null;   // waiting for the Wanderer's bodies (player-bodies.js loadWanderers)

  // The key that opened us closes us again, as it does in every game with a bag: I from the
  // sky (main.js ORBIT_KEYS), or wherever it is bound on foot. Not a repeat, not with a
  // modifier, and not the very press that opened us - from the sky main.js's listener runs
  // before this one and opens the panel in the middle of that same keydown.
  let openedAt = 0;
  const isToggle = (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.timeStamp <= openedAt) return false;
    const k = e.key.toLowerCase();
    return k === 'i' || k === keyOf('inventory');
  };
  function onKey(e) {
    if (el.hidden) return;
    if (e.key === 'Escape' || isToggle(e)) {
      // Stopped dead, not just from bubbling on: walk.js listens on this same window, and
      // close() has just let its feet go - so it would read this very Escape as "back to the
      // sky". stopPropagation cannot help with a listener on the same element; only
      // stopImmediatePropagation can. (An open popover has already caught this Escape in the
      // capture phase and closed itself instead - see popover.js.)
      e.preventDefault();
      e.stopImmediatePropagation();
      cancel();
      return;
    }
    e.stopPropagation();   // the slots own the keyboard while open, not the island
  }
  // Escape has to work whether focus is on the Avatar chip that opened us (caught on the
  // window) or on a slot inside the panel (caught here, before it bubbles away).
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' || isToggle(e)) { e.preventDefault(); cancel(); } e.stopPropagation(); });
  addEventListener('keydown', onKey);

  // One delegated listener for the panel's lifetime: the markup below is rebuilt on every
  // open, and a listener added per open would stack.
  el.addEventListener('click', (e) => {
    // Which body (Plans/tweede-avonturier.md): worn at once, like any other piece, and kept at
    // once too (saveCharacter) - so it is still you after a restart, and Never mind puts back
    // the rest of the look but not the body. Everything else on the spec carries over - the
    // hats, the armour and the pack are fitted to both bodies under the same names.
    const charBtn = e.target.closest('[data-character]');
    const sexBtn = e.target.closest('[data-sex]');
    if (charBtn || (sexBtn && !sexBtn.disabled)) {
      // The man or the woman, at the right (Plans/basislichamen-en-outfits.md): the same choice of
      // body as the portraits over the alcove, kept at once the same way.
      const kept = charBtn ? saveCharacter(charBtn.dataset.character) : saveCharacter('wanderer', sexBtn.dataset.sex);
      spec.character = kept.character; spec.body = kept.body;
      if (snapshot) { snapshot.character = kept.character; snapshot.body = kept.body; }
      sync(); apply(); return;
    }
    const slotBtn = e.target.closest('[data-slot]');
    if (slotBtn && slotBtn.disabled) return;
    if (slotBtn) return onSlot(INVENTORY_SLOTS.find((s) => s.id === slotBtn.dataset.slot), slotBtn);
    const dyeBtn = e.target.closest('[data-dye]');
    if (dyeBtn) return openDyes(dyeBtn.dataset.dye, dyeBtn);
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'av-edit') setView(el.dataset.view === 'character' ? 'inventory' : 'character');
    else if (btn.id === 'av-save') save();
    // normalizeAvatar(), not a spread of DEFAULT_AVATAR: a shallow spread would hand spec the
    // very same equip object DEFAULT_AVATAR holds, and the first toggle after it would mutate
    // the shared default for every settler reset after this one.
    else if (btn.id === 'av-reset') { spec = normalizeAvatar({}); sync(); apply(); }
    else if (btn.id === 'av-cancel' || btn.id === 'av-close') cancel();
  });

  const dyeHtml = (part, label) =>
    `<button class="inv-dye" data-dye="${part}" aria-label="${label}" title="${label}"></button>`;
  // A slot is a well with a canvas in it, its dye button hanging off the corner when it has a
  // colour of its own, and its name underneath. Toggles say so (aria-pressed); the rest open
  // something.
  const slotHtml = (slot) => `
    <div class="inv-slotwrap">
      <button class="inv-slot" data-slot="${slot.id}" aria-label="${slot.label}" title="${slot.label}"
        ${slot.kind === 'toggle' ? 'aria-pressed="false"' : 'aria-haspopup="dialog"'}><canvas class="inv-icon"></canvas></button>
      ${slot.dye ? dyeHtml(slot.dye, DYE_LABEL[slot.dye] || `${slot.label} colour`) : ''}
      <span class="inv-label">${slot.label}</span>
    </div>`;
  const flaskHtml = (flask, i) =>
    `<div class="inv-flask ${i === 0 ? 'left' : 'right'}">${dyeHtml(flask.dye, flask.label)}<span class="inv-label">${flask.label}</span></div>`;
  // The choice of body, over the alcove: a portrait of each, drawn by the same icon renderer
  // as the slots, and a radio group because exactly one is worn.
  const characterHtml = () => `<div class="inv-chars" role="radiogroup" aria-label="Character">${CHARACTER_PICKS.map((c) => `
      <button class="inv-char" role="radio" data-character="${c.id}" aria-checked="false" title="${c.name}">
        <canvas class="inv-icon"></canvas><span class="inv-label">${c.name}</span></button>`).join('')}</div>`;
  // The Wanderer's man or woman, at the top of the right pillar. Only the Wanderer has two bodies;
  // on the other two the choice stands greyed, saying why.
  const sexHtml = () => `<div class="inv-sexes" role="radiogroup" aria-label="Body">${SEXES.map((x) => `
      <button class="inv-sex" role="radio" data-sex="${x}" aria-checked="false" title="${SEX_LABEL[x]}">
        <canvas class="inv-icon"></canvas><span class="inv-label">${SEX_LABEL[x]}</span></button>`).join('')}</div>`;
  const column = (side) => INVENTORY_SLOTS.filter((s) => s.side === side).map(slotHtml).join('');
  // Edit character (Plans/basislichamen-en-outfits.md): who you are, apart from what you wear - the
  // body and the man or the woman on the left, skin and hair on the right. The same alcove, the same Wear it.
  const charLeft = () => `<span class="inv-label">Body</span>${characterHtml()}${sexHtml()}`;
  const charRight = () => ['skin', 'hair'].map((d) => `
      <div class="inv-flaskwrap">${dyeHtml(d, DYE_LABEL[d] || 'Skin colour')}<span class="inv-label">${d === 'skin' ? 'Skin' : 'Hair'}</span></div>`).join('');
  function setView(view) {
    pop?.close();
    el.dataset.view = view;
    const b = el.querySelector('#av-edit');
    if (b) b.textContent = view === 'character' ? 'Back to inventory' : 'Edit character';
    sync();
  }

  function open() {
    openedAt = performance.now();
    spec = loadAvatar();
    snapshot = { ...spec };
    el.hidden = false;
    // Two layers: the ornaments (the plate, the corners) hang outside the frame's edge, and
    // overflow clips at the padding box, so the scrolling happens one layer in.
    el.innerHTML = `
      <div class="inv-frame" role="dialog" aria-labelledby="inv-title">
        <i class="inv-corner tl"></i><i class="inv-corner tr"></i><i class="inv-corner bl"></i><i class="inv-corner br"></i>
        <h3 class="inv-title" id="inv-title">Inventory</h3>
        <button class="x" id="av-close" aria-label="Close">✕</button>
        <div class="inv-scroll">
          <div class="inv-top"><button class="btn" id="av-edit">Edit character</button></div>
          <div class="inv-body">
            <div class="inv-col left inv-gear">${column('left')}</div>
            <div class="inv-col left inv-who">${charLeft()}</div>
            <div class="inv-stage">
              <canvas id="av-canvas"></canvas>
              <p class="inv-loading" hidden>...</p>
              ${INVENTORY_FLASKS.map(flaskHtml).join('')}
            </div>
            <div class="inv-col right inv-gear">${column('right')}</div>
            <div class="inv-col right inv-who">${charRight()}</div>
          </div>
          <p class="inv-note">Your look lives in this browser, so it is yours to change whenever you like.</p>
          <div class="ho-buttons inv-actions">
            <button class="btn primary" id="av-save">Wear it</button>
            <button class="btn" id="av-reset">Reset</button>
            <button class="btn" id="av-cancel">Never mind</button>
          </div>
        </div>
      </div>`;
    // Both renderers after the markup: the icons paint into canvases that have to exist and
    // have a size first, and both go down with the markup so a re-open never stacks them.
    icons = makeIcons();
    preview = makePreview(el.querySelector('#av-canvas'));
    setView('inventory');
    apply();
    // The Wanderer's bodies are loaded the first time anybody may pick one (player-bodies.js): until
    // they are in, the alcove says so, the figure and the portraits are the Adventurer, and once they
    // land every thumbnail is painted again (its key cannot tell the stand-in from the real body).
    if (!wanderersReady()) {
      const note = el.querySelector('.inv-loading');
      note.hidden = false;
      loadWanderers();
      forgetBodies = onWanderers(() => {
        forgetBodies = null;
        note.hidden = true;
        for (const c of el.querySelectorAll('canvas[data-key]')) delete c.dataset.key;
        if (icons) sync();
        if (preview) preview.set(spec);
      });
    }
  }

  function onSlot(slot, btn) {
    if (slot.garment && slotPicks(slot, spec)) {
      openGarment(slot, btn);
    } else if (slot.kind === 'toggle') {
      // A fresh object every time, not a mutation of spec.equip in place: spec can still be
      // the DEFAULT_AVATAR-derived one from Reset, and mutating that would leak into every
      // settler's default look instead of just this session's.
      spec.equip = { ...spec.equip, [slot.equip]: !spec.equip?.[slot.equip] };
      sync(); apply();
    } else if (slot.kind === 'dye') {
      openDyes(slot.dye, btn);
    } else {
      openPicker(slot, btn);
    }
  }

  // Clicking the button a popover hangs off closes it again; any other opens a fresh one
  // (openPopover takes whatever was up down first).
  function toggled(anchor) {
    if (pop && pop.anchor === anchor) { pop.close(); return true; }
    return false;
  }
  // Where a popover goes: in from the pillar, towards the figure - so a picker never covers
  // the column it came from - and up from a flask.
  const sideOf = (anchor) => (anchor.closest('.inv-col.left') ? 'right' : anchor.closest('.inv-col.right') ? 'left' : 'top');

  // A picker closes on a choice: picking an item is a decision. Its tiles are painted after
  // the popover is in the document, because a canvas measures zero wide until it is.
  function openPicker(slot, anchor) {
    if (toggled(anchor)) return;
    const current = slot.field ? spec[slot.field] : (spec.equip?.[slot.equip] || '');
    const outer = document.createElement('div');
    const box = document.createElement('div');
    box.className = 'inv-pop';
    outer.appendChild(box);
    for (const opt of slot.options) {
      // A piece somebody has not found yet stays in the picker as its own silhouette, saying
      // where it comes from, and does nothing when clicked. The tile is the same size and
      // paints the same icon (a CSS filter makes the silhouette), so finding the piece changes
      // nothing about the layout. Not `disabled`: a disabled button swallows its tooltip.
      const need = unlockOf(opt.id);
      const locked = !!need && !isUnlocked(need);
      const tile = document.createElement('button');
      tile.className = `inv-tile${opt.id === current ? ' on' : ''}${locked ? ' locked' : ''}`;
      tile.title = locked ? (byId(opt.id)?.hint || 'Not found yet') : opt.name;
      if (locked) tile.setAttribute('aria-disabled', 'true');
      tile.innerHTML = `<canvas class="inv-icon"></canvas><span>${locked ? (byId(opt.id)?.hint || 'Locked') : opt.name}</span>`;
      tile.addEventListener('click', () => {
        if (locked) return;
        if (slot.field) spec[slot.field] = opt.id;
        else spec.equip = { ...spec.equip, [slot.equip]: opt.id || null };
        sync(); apply();
        pop?.close();
      });
      box.appendChild(tile);
    }
    // The hat's own colour, under the hats (the head's dye button is the hair now): the palette's
    // tiles, which keep the picker up, so a colour can be tried on the hat that is worn.
    if (slot.pickerDye) {
      const dyes = document.createElement('div');
      dyes.className = 'inv-pop dyes inv-pop-sub';
      dyes.setAttribute('aria-label', DYE_LABEL[slot.pickerDye]);
      dyeTiles(slot.pickerDye, dyes);
      outer.appendChild(dyes);
    }
    pop = openPopover({ anchor, content: outer, side: sideOf(anchor), className: 'inv-popover', onClose: () => { pop = null; } });
    const body = characterOf(spec).id;
    [...box.children].forEach((tile, i) => icons.paint(tile.firstElementChild, optionIcon(slot, slot.options[i].id, body), spec));
  }

  // A palette stays up after a choice: colours are compared on the figure, one after another,
  // and closing on every pick would make that a click-and-reopen dance. Outside, Escape or
  // the dye button itself closes it.
  function openDyes(part, anchor) {
    if (toggled(anchor)) return;
    const outer = document.createElement('div');
    const box = document.createElement('div');
    box.className = 'inv-pop dyes';
    dyeTiles(part, box);
    // A Wanderer's hair is a style as well as a colour: its hairstyles over the colours, and the
    // picker stays up, so a style can be tried with the colour on it.
    const body = characterOf(spec).id;
    const styles = part === 'hair' && characterOf(spec).wanderer ? hairStyles(body) : [];
    if (styles.length) {
      const row = document.createElement('div');
      row.className = 'inv-pop inv-pop-styles';
      for (const h of styles) row.appendChild(tileFor(h.name, () => { spec.hairStyle = h.id; lightRow(row, h.id); sync(); apply(); }, h.id));
      lightRow(row, spec.hairStyle || characterOf(spec).hair);
      outer.appendChild(row);
      box.classList.add('inv-pop-sub');
    }
    outer.appendChild(box);
    pop = openPopover({ anchor, content: outer, side: sideOf(anchor), className: 'inv-popover', onClose: () => { pop = null; } });
    styles.forEach((h, i) => icons.paint(outer.firstElementChild.children[i].firstElementChild, hairIcon(h.id, body), spec));
  }

  // A tile with an icon well and a name, for the clothes' and the hairstyles' pickers.
  function tileFor(name, onPick, value) {
    const tile = document.createElement('button');
    tile.className = 'inv-tile';
    tile.dataset.value = value ?? '';
    tile.title = name;
    tile.innerHTML = `<canvas class="inv-icon"></canvas><span>${name}</span>`;
    tile.addEventListener('click', onPick);
    return tile;
  }
  const lightRow = (row, value) => [...row.children].forEach((t) => t.classList.toggle('on', t.dataset.value === (value ?? '')));

  // A Wanderer's clothes (Plans/basislichamen-en-outfits.md): one slot's pieces - each set's, the
  // slot's armour, nothing - one of them worn. Stays up, so the pieces can be tried on the figure
  // one after another.
  function openGarment(slot, anchor) {
    if (toggled(anchor)) return;
    const body = characterOf(spec).id;
    const box = document.createElement('div');
    box.className = 'inv-pop';
    const paints = [];
    for (const o of garmentOptions(slot, body)) {
      const tile = tileFor(o.name, () => { spec = wearIn(slot, spec, o.id); lightRow(box, o.id); sync(); apply(); }, o.id);
      box.appendChild(tile);
      paints.push([tile, o.armour ? { id: `${body}:${slot.id}:armour`, parts: slot.parts, character: body } : garmentIcon(slot.garment, o.id, body)]);
    }
    lightRow(box, garmentWorn(slot, spec));
    pop = openPopover({ anchor, content: box, side: sideOf(anchor), className: 'inv-popover', onClose: () => { pop = null; } });
    for (const [tile, icon] of paints) icons.paint(tile.firstElementChild, icon, spec);
  }

  // A palette's tiles into `box`: every swatch of `part`, then the colours the chests give.
  function dyeTiles(part, box) {
    const light = () => [...box.children].forEach((t) => t.classList.toggle('on', Number(t.dataset.hex) === spec[part]));
    for (const s of SWATCHES[part]) {
      const tile = document.createElement('button');
      tile.className = 'inv-tile dye';
      tile.dataset.hex = s.hex;
      tile.title = s.name;
      tile.setAttribute('aria-label', s.name);
      tile.style.setProperty('--sw', hex(s.hex));
      tile.addEventListener('click', () => { spec[part] = s.hex; light(); sync(); apply(); });
      box.appendChild(tile);
    }
    // The colours the chests give, after the ones everybody has: a locked one is a dull disc that
    // says where it comes from and does nothing when clicked (the hat picker's way, for dyes).
    if (PLAYER_SWATCH_PARTS.includes(part)) {
      for (const s of PLAYER_SWATCHES) {
        const locked = !isUnlocked(s.id);
        const tile = document.createElement('button');
        tile.className = `inv-tile dye${locked ? ' locked' : ''}`;
        tile.dataset.hex = s.hex;
        tile.title = locked ? s.hint : s.name;
        tile.setAttribute('aria-label', locked ? `${s.name} (locked)` : s.name);
        if (locked) tile.setAttribute('aria-disabled', 'true');
        tile.style.setProperty('--sw', locked ? '#34363b' : hex(s.hex));
        tile.addEventListener('click', () => {
          if (locked) return;
          spec[part] = s.hex; light(); sync(); apply();
        });
        box.appendChild(tile);
      }
    }
    light();
  }

  // Light up what is worn, and repaint whichever icons the current spec makes stale - which
  // makeIcons decides per canvas, so a hat recolour touches the head slot and nothing else.
  function sync() {
    const pick = pickOf(spec);
    for (const c of el.querySelectorAll('[data-character]')) {
      const on = c.dataset.character === pick;
      c.classList.toggle('on', on);
      c.setAttribute('aria-checked', String(on));
      icons.paint(c.firstElementChild, characterIcon(c.dataset.character === 'wanderer' ? wandererOf(spec) : c.dataset.character), spec);
    }
    for (const b of el.querySelectorAll('[data-sex]')) {
      const on = pick === 'wanderer' && spec.body === b.dataset.sex;
      b.disabled = pick !== 'wanderer';
      b.title = b.disabled ? 'Only the Wanderer has a man and a woman' : SEX_LABEL[b.dataset.sex];
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      icons.paint(b.firstElementChild, characterIcon(`wanderer-${b.dataset.sex}`), spec);
    }
    // A dye this body does not read (the Adventurer's own skin and cloth are painted, not
    // dyed) is taken away rather than left to do nothing: its button, its flask, and the
    // Outfit slot, which is nothing but that dye.
    for (const d of el.querySelectorAll('.inv-dye')) {
      const off = !dyeApplies(d.dataset.dye, spec);
      (d.closest('.inv-flask') || d).hidden = off;
    }
    for (const slot of INVENTORY_SLOTS) {
      const b = el.querySelector(`[data-slot="${slot.id}"]`);
      const picks = slot.garment && slotPicks(slot, spec);
      b.disabled = !slotOffers(slot, spec) || (slot.kind === 'dye' && !dyeApplies(slot.dye, spec));
      b.title = b.disabled && slot.id === 'tunic' && characterOf(spec).wanderer ? 'No outfits yet' : slot.label;
      const on = picks ? garmentWorn(slot, spec) !== null
        : slot.kind === 'garment' ? false
        : slot.kind === 'dye' ? !b.disabled : slot.field ? spec[slot.field] !== 'none' : !!spec.equip?.[slot.equip];
      b.classList.toggle('on', on);
      if (slot.kind === 'toggle') b.setAttribute('aria-pressed', String(on));
      icons.paint(b.firstElementChild, slotIcon(slot, spec), spec);
    }
    el.querySelectorAll('.inv-dye').forEach((d) => d.style.setProperty('--dye', hex(spec[d.dataset.dye])));
  }

  // Show the change in the alcove and on the character out on the island at once.
  function apply() {
    if (preview) preview.set(spec);
    onApply && onApply(normalizeAvatar(spec));
  }

  function save() { spec = saveAvatar(spec); onApply && onApply(spec); teardown(); onClose && onClose(); }
  function cancel() {
    if (snapshot) onApply && onApply(normalizeAvatar(snapshot));   // back into what they arrived in
    teardown();
    onClose && onClose();
  }

  function teardown() {
    closePopover();   // it lives in body, not in el - clearing el would leave it standing
    if (forgetBodies) { forgetBodies(); forgetBodies = null; }
    if (icons) { icons.dispose(); icons = null; }
    if (preview) { preview.dispose(); preview = null; }
    el.hidden = true;
    el.innerHTML = '';
  }

  return {
    open, close: cancel, isOpen: () => !el.hidden,
    dispose: () => { removeEventListener('keydown', onKey); teardown(); el.remove(); },
  };
}

// The same light rig for the alcove and the slot icons, so a piece looks in its well the way
// it looks on the figure.
function light(scene) {
  scene.add(new THREE.HemisphereLight(0xfff3e0, 0x2a2f3a, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1.4, 2.4, 1.9);
  scene.add(key);
}
const figureMaterial = () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: false, roughness: 0.85, metalness: 0 });

// renderer.dispose() alone leaves the GL context alive until its canvas is collected, and the
// browser caps live contexts (Chrome at sixteen, oldest evicted first - which, after enough
// visits to this screen, is the island's own). forceContextLoss() gives it back now. Called
// after dispose(), which has already removed three.js's own context-lost listener, so the
// loss is silent.
function release(renderer) {
  renderer.dispose();
  renderer.forceContextLoss();
}

// A self-contained preview: its own renderer, one light rig, one figure held at a fixed
// three-quarter angle. It used to turn slowly on its own; turning it while you are trying
// to look at one spot on it (a new helmet, say) made it harder to judge, not easier, so it
// now just stands there. Runs only while the panel is open and is torn down with it, so it
// never competes with the island's own frame loop for long.
function makePreview(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  cam.position.set(0, 0.46, 1.45);
  cam.lookAt(0, 0.27, 0);
  light(scene);

  const mat = figureMaterial();
  const pivot = new THREE.Group();
  pivot.rotation.y = 0.5;   // a fixed three-quarter turn, not a spin
  const classic = createClassicAvatar(DEFAULT_AVATAR, mat);
  pivot.add(classic.object);
  scene.add(pivot);

  function resize() {
    const w = canvas.clientWidth || 220, h = canvas.clientHeight || 300;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  requestAnimationFrame(resize);   // wait for layout before sizing to the canvas

  let raf = 0, alive = true, last = performance.now();
  function tick(now) {
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    classic.update({ moving: true, distance: dt * WALK_SPEED, running: false, grounded: true, crouching: false,
      sitting: false, lying: false, phase: now * 0.009 }, dt);
    renderer.render(scene, cam);
  }
  raf = requestAnimationFrame(tick);

  return {
    set(spec) {
      classic.set(spec);
    },
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
      classic.dispose();
      mat.dispose();
      release(renderer);
    },
  };
}

// The slot thumbnails: one offscreen renderer that draws each piece by itself and copies the
// result into that slot's own 2D canvas. drawImage() straight after render() needs no
// preserveDrawingBuffer - a WebGL drawing buffer is only cleared once the browser has
// composited it, at the end of the task, and this copy happens well before that. A GPU copy
// rather than toDataURL(): no PNG encode, no base64, no <img> to decode. Orthographic, so the
// bounding box fits exactly and a hat and a sword read at the same scale. Every paint is
// keyed (inventory.js's iconKey) on the icon and the colours its parts actually read, so a
// recolour repaints only what it touched and an equip toggle repaints nothing at all - the
// dimmed "not worn" look is CSS on the canvas.
const ICON_PX = 128;   // source size in CSS px; a well is 64, so it is drawn down by half
function makeIcons() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(dpr);
  renderer.setSize(ICON_PX, ICON_PX, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  light(scene);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
  cam.position.set(2.2, 1.9, 3.4).normalize().multiplyScalar(8);   // the alcove's three-quarter view, a little higher
  cam.lookAt(0, 0, 0);
  const mat = figureMaterial();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  scene.add(mesh);
  const box = new THREE.Box3(), size = new THREE.Vector3(), centre = new THREE.Vector3();

  function paint(canvas, icon, spec) {
    const key = iconKey(icon, spec);
    if (canvas.dataset.key === key) return;   // nothing this thumbnail reads has changed
    canvas.dataset.key = key;
    const px = Math.round((canvas.clientWidth || 64) * dpr);
    canvas.width = canvas.height = px;
    mesh.geometry.dispose();
    mesh.geometry = iconGeometry(icon, spec);
    if (!mesh.geometry.attributes.position) { canvas.getContext('2d').clearRect(0, 0, px, px); return; }   // a Wanderer's, still loading
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(...(icon.pose || [0, 0, 0]));
    box.setFromObject(mesh);   // after the pose, so a tilted blade still fits its well
    const r = box.getSize(size).length() / 2 * 1.08;
    mesh.position.copy(box.getCenter(centre)).negate();
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(renderer.domElement, 0, 0, px, px);
  }

  function dispose() {
    mesh.geometry.dispose();
    mat.dispose();
    release(renderer);
  }

  return { paint, dispose };
}
