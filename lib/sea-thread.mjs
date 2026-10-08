// The islander's own sea, on a thread of its own.
//
// A sea of our own (single, host) used to run on the islander's event loop, beside the scan.
// A scan of Hoogezand holds that loop 1.4 to 2 seconds at a time (measured on a copy, 8 October
// 2026: `discover` stats and reads ~1400 transcripts and session files synchronously, then
// buildVillage + placeAll), and one at lunch took over half a minute: for all that time the
// sea's beat did not run, every settler stood frozen mid-step on every screen, and the walk
// that came back owed more ticks than `maxTicksPerBeat` and simply lost them. The sea needs
// nothing of the islander's - it reads no disk and is reached over its own port, which is how
// a sea in a container works too - so here it gets a loop no scan can hold.
//
// The handle this returns is the part of createSea's that serve.mjs uses: `listen`, `address`,
// `close` and `setTime` (which becomes a promise: it crosses a thread). Everything else -
// the islander's publish, the page's socket - already went over the network.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const MARK = 'promptholm-sea';

// `opts` is createSea's, less `log`, which stays on this side: the worker hands every line over.
export function startSeaThread({ log = () => {}, ...opts } = {}) {
  const worker = new Worker(new URL(import.meta.url), { workerData: { [MARK]: true, opts } });
  let seq = 0;
  const pending = new Map();
  let addr = null;
  let gone = false;
  const settle = (why) => {
    for (const p of pending.values()) p.reject(why);
    pending.clear();
  };
  worker.on('message', (m) => {
    if (!m) return;
    if (m.t === 'log') { log(m.m); return; }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) {
      const e = new Error(m.error.message);
      if (m.error.code) e.code = m.error.code;
      p.reject(e);
    } else p.resolve(m.value);
  });
  worker.on('error', (e) => { log(`the sea's thread failed: ${e && e.stack ? e.stack : e}`); });
  worker.on('exit', (code) => {
    gone = true;
    addr = null;
    settle(new Error(`the sea's thread stopped (${code})`));
  });
  const ask = (op, arg) => new Promise((resolve, reject) => {
    if (gone) { reject(new Error('the sea\'s thread has stopped')); return; }
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, op, arg });
  });
  return {
    async listen() { addr = await ask('listen'); return addr; },
    address: () => addr,
    setTime: (want) => ask('setTime', want),
    async close() {
      if (gone) return;
      try { await ask('close'); } catch { /* it is going either way */ }
      addr = null;
      await worker.terminate();
    },
    thread: worker,
  };
}

// ---- the other side: the thread itself -------------------------------------------------
if (!isMainThread && workerData && workerData[MARK]) {
  const { createSea } = await import('./sea.mjs');
  const say = (m) => parentPort.postMessage({ t: 'log', m: String(m) });
  // A bad request must never take the sea down - the islander's own handler used to catch
  // these for it when it shared the process.
  process.on('uncaughtException', (e) => say(`uncaught: ${e && e.stack ? e.stack : e}`));
  process.on('unhandledRejection', (e) => say(`rejection: ${e && e.stack ? e.stack : e}`));
  const sea = createSea({ ...workerData.opts, log: say });
  const ops = {
    listen: () => sea.listen(),
    setTime: (want) => sea.setTime(want),
    close: () => sea.close(),
  };
  parentPort.on('message', async ({ id, op, arg }) => {
    try {
      const value = await ops[op](arg);
      parentPort.postMessage({ id, value });
    } catch (e) {
      parentPort.postMessage({ id, error: { message: String((e && e.message) || e), code: e && e.code } });
    }
  });
}
