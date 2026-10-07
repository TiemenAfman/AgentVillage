// Parses a lazily loaded model set (lazy-module.js offThread: models.js LAZY, the Wanderer's
// bodies) off the main thread. The Salty Kraken's hall is a 34 MB object literal, and importing it
// on the page froze a frame for ~1.2 s the first time anybody walked up to the door
// (Plans/minder-browser-meer-spel.md). Here the module is imported and every part's `keys`
// (positions and colours, unless the caller names more) become Float32Arrays whose buffers are
// *transferred* back, so the page receives them without copying or parsing anything.
// Every reader of a part indexes it or hands it to a typed array or a BufferAttribute, which
// takes a typed array as it takes a plain one. A set is `{ parts: { name: part } }` (a model set)
// or `{ <key>: { parts: [part] } }` (bodies-mesh.js, one per body).
self.onmessage = async ({ data: { url, name, keys = ['positions', 'colors'] } }) => {
  try {
    const set = (await import(url))[name];
    const lists = set.parts ? [Object.values(set.parts)]
      : Object.values(set).filter((v) => v && Array.isArray(v.parts)).map((v) => v.parts);
    const move = [];
    for (const parts of lists) {
      for (const part of parts) {
        for (const key of keys) {
          const a = part[key];
          if (Array.isArray(a) && a.length > 3) { part[key] = new Float32Array(a); move.push(part[key].buffer); }
        }
      }
    }
    self.postMessage({ set }, move);
  } catch (e) {
    self.postMessage({ error: String(e && e.message || e) });
  }
};
