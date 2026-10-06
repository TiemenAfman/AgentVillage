// Parses a lazily loaded model set (models.js LAZY) off the main thread. The Salty Kraken's hall
// is a 34 MB object literal, and importing it on the page froze a frame for ~1.2 s the first
// time anybody walked up to the door (Plans/minder-browser-meer-spel.md). Here the module is
// imported and every part's positions and colours become Float32Arrays whose buffers are
// *transferred* back, so the page receives them without copying or parsing anything.
// Every reader of a part indexes it or hands it to a Float32BufferAttribute, which takes a
// typed array as it takes a plain one.
self.onmessage = async ({ data: { url, name } }) => {
  try {
    const set = (await import(url))[name];
    const move = [];
    for (const part of Object.values(set.parts)) {
      for (const key of ['positions', 'colors']) {
        const a = part[key];
        if (Array.isArray(a) && a.length > 3) { part[key] = new Float32Array(a); move.push(part[key].buffer); }
      }
    }
    self.postMessage({ set }, move);
  } catch (e) {
    self.postMessage({ error: String(e && e.message || e) });
  }
};
