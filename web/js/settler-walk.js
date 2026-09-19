// The walk moved to shared/settlerwalk.mjs.
//
// It had to: the sea steps every island's crowd in Node, where there is no renderer and no
// document, so the code that decides where a body is cannot live under web/. Nothing else
// changed - this file is the same names in the same order, re-exported, so the import in
// web/js/settlers.js and anything that reached for findPath still work.
//
// New code should import from 'shared/settlerwalk.mjs' directly.
export { createWalk, findPath, lerpAngle, dist, MAX_STROLL, DT } from 'shared/settlerwalk.mjs';
