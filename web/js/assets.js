// Where the island's own files are, worked out from where this module came from.
//
// Three files each carried `const TEXTURES = 'textures/'` and handed it to a TextureLoader.
// A relative URL like that resolves against the *document*, not against the code, so it is
// right for a page at / and wrong the moment the island is served at a subpath: at
// https://example/island/ the loader would ask for https://example/textures/ and every
// surface on the island would quietly stay untextured. It works today by luck rather than
// by design, and the luck runs out behind the first reverse proxy.
//
// `import.meta.url` is the fix and needs no configuration: this file is at <root>/js/, so
// `../textures/` is <root>/textures/ wherever <root> happens to be. Same trick, same
// reason, as the two bases in api.js.
export const ASSET_BASE = new URL('../textures/', import.meta.url);

// The URL of one texture, as a string, because that is what THREE.TextureLoader wants.
export function textureUrl(name) {
  return new URL(`${name}.png`, ASSET_BASE).href;
}

// And the same for the baked glTF the walking figure and the model sheet load. Those were
// origin-absolute strings handed straight to GLTFLoader, which is why the fetch sweep
// never saw them: a loader's path is not a fetch at a glance, and it is just as absolute.
export const MODEL_BASE = new URL('../models/', import.meta.url);
export function modelUrl(name) {
  return new URL(name, MODEL_BASE).href;
}
