// The settlers, in one piece again.
//
// This file used to be 894 lines doing two unrelated jobs: working out where everybody
// walks, and drawing them. It split into:
//
//   web/js/settler-walk.js     where a body is. No three.js, no document, no colour.
//   web/js/settler-figures.js  what is drawn there. Every mesh, every sine wave.
//
// Only these four exports outlived the split - characters.js, demo.js, facetoface.js,
// interior.js and walk.js still import them from here - because crowd-view.js took over
// walking every figure off the wire and there is no local simulation left to feed them.
export { eyeHeight, styleLook, settlerLook, figureGeometry } from './settler-figures.js';
