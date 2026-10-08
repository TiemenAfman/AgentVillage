// The islander's own sea keeps its beat while the islander is busy (lib/sea-thread.mjs).
//
// 8 October 2026, lunch on Hoogezand: the island's scan held the islander's event loop - for
// seconds every minute, once for over half a minute - and the sea ran on that same loop, so
// every settler on every screen stood frozen mid-step. The sea is on a thread of its own now;
// here the main thread is blocked the way a scan blocks it, and the sea's clock must have run
// on through it rather than catching up the few ticks `maxTicksPerBeat` allows afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startSeaThread } from '../lib/sea-thread.mjs';

const health = async (addr) => (await fetch(`http://127.0.0.1:${addr.port}/health`)).json();

// What a scan does to the loop: synchronous work, nothing else runs.
function hold(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* a scan reading 1400 files */ }
}

test('the beat runs on while the islander is held up', async () => {
  const lines = [];
  const sea = startSeaThread({ port: 0, host: '127.0.0.1', name: 'Test sea', starters: false, log: (m) => lines.push(m) });
  try {
    const addr = await sea.listen();
    assert.ok(addr && addr.port > 0, 'it listens');
    assert.equal(sea.address().port, addr.port);
    // A beat or two first, so the clock has started.
    await new Promise((d) => setTimeout(d, 300));
    const a = (await health(addr)).ticks;
    hold(2000);
    const b = (await health(addr)).ticks;
    // 2 s is 40 ticks of the walk (DT 0.05). Held on one loop, the crowd would have caught up
    // at most maxTicksPerBeat (8) of them when it was let go.
    assert.ok(b - a >= 30, `the sea's clock stood still while the islander was busy: ${b - a} ticks in 2 s`);
  } finally {
    await sea.close();
  }
});

test('the host sets the clock across the thread, and a bad hour is refused', async () => {
  const sea = startSeaThread({ port: 0, host: '127.0.0.1', name: 'Test sea', starters: false });
  try {
    await sea.listen();
    const c = await sea.setTime({ real: true });
    assert.equal(c.shift, 0);
    await assert.rejects(sea.setTime({ hour: 99 }), /an hour from 0 to 24/);
  } finally {
    await sea.close();
  }
  assert.equal(sea.address(), null, 'closed');
  await assert.rejects(sea.setTime({ real: true }), /stopped/);
});

test('a port already taken is refused, and the thread does not stay behind', async () => {
  const first = startSeaThread({ port: 0, host: '127.0.0.1', starters: false });
  const addr = await first.listen();
  const second = startSeaThread({ port: addr.port, host: '127.0.0.1', starters: false });
  try {
    await assert.rejects(second.listen(), (e) => e.code === 'EADDRINUSE');
  } finally {
    await second.close();
    await first.close();
  }
});
