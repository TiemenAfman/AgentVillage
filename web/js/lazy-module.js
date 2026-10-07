// Imports a big baked module off the main thread (lazy-set-worker.js) and hands back one of its
// exports, its long number arrays as transferred Float32Arrays. The Salty Kraken's hall
// (models.js LAZY) and the Wanderer's bodies (player-bodies.js) go through here: both are tens of
// megabytes of object literal, and importing one on the page stopped it for over a second.
// `url` is absolute (resolve it against the caller's import.meta.url, so a subpath behind a proxy
// works); `keys` names which fields of each part become typed arrays - every reader of those indexes
// them or copies them into a typed array, which takes a typed array as it takes a plain one. Under
// Node, or wherever a module worker cannot start, the module is imported here as before.
export function offThread(url, name, keys = ['positions', 'colors']) {
  const here = () => import(url).then((m) => m[name]);
  if (typeof Worker === 'undefined') return here();
  return new Promise((resolve) => {
    let w;
    try { w = new Worker(new URL('./lazy-set-worker.js', import.meta.url), { type: 'module' }); }
    catch { resolve(here()); return; }
    const done = (v) => { w.terminate(); resolve(v); };
    w.onmessage = ({ data }) => done(data.set ? data.set : here());
    w.onerror = (e) => { e.preventDefault(); done(here()); };
    w.postMessage({ url, name, keys });
  });
}
