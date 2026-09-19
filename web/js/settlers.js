// The settlers, in one piece again.
//
// This file used to be 894 lines doing two unrelated jobs: working out where everybody
// walks, and drawing them. It is now the seam between the two halves that job split into,
// and its whole purpose is that nothing else on the island had to notice:
//
//   web/js/settler-walk.js     where a body is. No three.js, no document, no colour.
//   web/js/settler-figures.js  what is drawn there. Every mesh, every sine wave.
//
// The API below is exactly the one createSettlers has always returned, in the same order,
// and the four standalone exports are re-exported unchanged - characters.js, demo.js,
// facetoface.js, interior.js and walk.js all still import them from here.
//
// Three small joins are worth knowing about, because they are the only places the halves
// have to agree:
//
//   `look` is computed here, once, and handed to both. The walk needs one number out of
//   it (height, which sets the stride); the wardrobe needs all of it.
//   A figure that cannot get a slot is taken back out of the walk again. The old code
//   returned null before adding anything, and a body being stepped every frame while
//   being drawn nowhere is a leak that would never announce itself.
//   `update` is `step` then `draw`, in that order, off the same dt.
export { eyeHeight, styleLook, settlerLook, figureGeometry } from './settler-figures.js';

import { settlerLook, createFigures, kindOf, styleOf } from './settler-figures.js';
import { createWalk } from './settler-walk.js';

export function createSettlers(scene, material, terrain) {
  const walk = createWalk(terrain);
  const view = createFigures(scene, material);
  const figures = walk.figures;

  function add(id, spec, worldPos, opts = {}) {
    if (figures.has(id)) return figures.get(id);
    const kind = kindOf(spec);
    const look = settlerLook(id, styleOf(spec), kind);
    const f = walk.spawn(id, spec, worldPos, opts, look.height);
    if (!view.enrol(f, look, kind)) { figures.delete(id); return null; }
    return f;
  }

  function remove(id) {
    const f = walk.setVisible(id, false);
    if (f) view.hide(f);
  }

  function setVisible(id, v) {
    const f = walk.setVisible(id, v);
    if (f && !v) view.hide(f);
  }

  function update(dt, nightAmount) {
    walk.step(dt, nightAmount);
    view.draw(figures, dt);
  }

  return {
    add, remove, setMode: walk.setMode, setVisible, attend: walk.attend, unattend: walk.unattend,
    setRoads: walk.setRoads, setDecks: walk.setDecks, setGather: walk.setGather,
    walkIn: walk.walkIn, update, figures,
    available: walk.available, charter: walk.charter, routeTo: walk.routeTo, sendOut: walk.sendOut,
    carry: walk.carry, release: walk.release, has: walk.has, where: walk.where,
    pickables: view.pickables, figureAt: view.figureAt,
    findPath: walk.findPath,
  };
}
