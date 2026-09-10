// Other islands on the same network. Every island shouts its name over UDP every few
// seconds and listens for the others doing the same, so two people running Promptholm in
// the same office find each other without anybody typing an address.
//
// The beacon carries the seed and the grid size, which is the whole trick behind the
// islands on the horizon: shared/terrain.mjs makes identical land from identical numbers
// in either runtime, so a neighbour can draw your island's true shape from four fields in
// a datagram, without ever connecting to you.
//
// Everything arriving here is unvalidated traffic from the network. It is treated as
// such: shape-checked, clamped, and capped in number.
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import os from 'node:os';

const GROUP = '239.255.47.47';
const PORT = 47474;
const BEACON_MS = 5000;
const GONE_MS = 15000;
const MAX_NEIGHBOURS = 24;

function ownInterfaces() {
  const out = [];
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const nic of list || []) {
        if (!nic.internal && nic.family === 'IPv4') out.push(nic.address);
      }
    }
  } catch { /* no interfaces, no neighbours */ }
  return out;
}

// Stable without needing a file: the same machine on the same port is the same island,
// across restarts, and two islands on one machine still differ.
function instanceId(port) {
  return crypto.createHash('sha1').update(`${os.hostname()}:${port}`).digest('hex').slice(0, 16);
}

function text(v, max) {
  if (typeof v !== 'string') return '';
  let out = '';
  for (const ch of v) {
    const c = ch.codePointAt(0);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) continue;
    out += ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

function whole(v, lo, hi) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= lo && n <= hi ? n : null;
}

// Somebody else's beacon, or nothing at all.
function parseBeacon(buf) {
  let m;
  try { m = JSON.parse(buf.toString('utf8')); } catch { return null; }
  if (!m || typeof m !== 'object' || m.app !== 'promptholm' || m.v !== 1) return null;
  if (typeof m.id !== 'string' || !/^[a-f0-9]{8,64}$/i.test(m.id)) return null;
  const port = whole(m.port, 1, 65535);
  const gridSize = whole(m.gridSize, 16, 512);
  if (port === null || gridSize === null) return null;
  if (typeof m.seed !== 'number' || !Number.isFinite(m.seed)) return null;
  return {
    id: m.id,
    bye: m.bye === true,
    name: text(m.name, 24) || 'Someone',
    island: text(m.island, 32) || 'an island',
    port,
    seed: m.seed,
    gridSize,
    settlers: whole(m.settlers, 0, 100000) ?? 0,
  };
}

export function createNeighbours({ port, name, islandName, seed, gridSize, announcing = false, settlers = () => 0, log = () => {}, onChange = () => {} } = {}) {
  const me = instanceId(port);
  const seen = new Map();   // id -> neighbour
  let sock = null;
  let beacon = null;
  let sweep = null;

  const list = () => [...seen.values()]
    .map(({ id, name: who, island, address, port: p, seed: s, gridSize: g, settlers: n, firstSeen }) => ({
      id, name: who, island, address, port: p, seed: s, gridSize: g, settlers: n, firstSeen,
      url: `http://${address}:${p}/`,
    }))
    .sort((a, b) => a.firstSeen - b.firstSeen);

  // Announcing and listening are not the same thing, and they do not deserve the same
  // answer. A shut island has nothing to offer a visitor - anyone who saw it and sailed
  // over would be turned away at the door - and calling your own name across the network
  // every five seconds when nobody can come in is nobody's idea of quiet. So a shut
  // island keeps its mouth closed and its ears open: it stays invisible, and it can still
  // see the neighbours who did open theirs, and go and visit them.
  function announce(bye = false) {
    if (!sock || !announcing) return;
    const body = Buffer.from(JSON.stringify({
      app: 'promptholm', v: 1, id: me, bye: bye || undefined,
      name, island: islandName, port, seed, gridSize, settlers: settlers(),
    }), 'utf8');
    try { sock.send(body, 0, body.length, PORT, GROUP); } catch { /* the network comes and goes */ }
  }

  function onMessage(buf, rinfo) {
    const b = parseBeacon(buf);
    if (!b || b.id === me) return;
    if (b.bye) {
      if (seen.delete(b.id)) onChange(list());
      return;
    }
    const had = seen.get(b.id);
    if (!had && seen.size >= MAX_NEIGHBOURS) return;   // a flood does not get to fill memory
    seen.set(b.id, {
      ...b,
      address: rinfo.address,
      firstSeen: had ? had.firstSeen : Date.now(),
      lastSeen: Date.now(),
    });
    // Only a new arrival or a rename is worth waking the page for; the other four
    // beacons a minute say nothing new.
    if (!had || had.name !== b.name || had.island !== b.island || had.settlers !== b.settlers) {
      log(had ? `neighbour ${b.name} updated` : `neighbour ${b.name} appeared on ${rinfo.address}`);
      onChange(list());
    }
  }

  function start() {
    sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', (e) => { log(`neighbour beacon stopped: ${e && e.message}`); try { sock.close(); } catch {} sock = null; });
    sock.on('message', onMessage);
    sock.bind(PORT, () => {
      try { sock.setMulticastTTL(1); } catch { /* stays on this network either way */ }
      try { sock.setBroadcast(true); } catch { /* multicast is the main road */ }
      let joined = 0;
      for (const addr of ownInterfaces()) {
        try { sock.addMembership(GROUP, addr); joined++; } catch { /* this card cannot, another might */ }
      }
      if (!joined) { try { sock.addMembership(GROUP); joined = 1; } catch { /* no multicast here */ } }
      log(`listening for other islands on ${GROUP}:${PORT} (${joined} interface${joined === 1 ? '' : 's'})`
        + (announcing ? `, announcing this one as "${name}"` : ', not announcing this one: the island is shut'));
      announce();
    });

    beacon = setInterval(() => announce(), BEACON_MS);
    beacon.unref?.();
    // Three missed beacons and an island is treated as gone. A laptop closing does not
    // get to say goodbye.
    sweep = setInterval(() => {
      const now = Date.now();
      let dropped = false;
      for (const [id, n] of seen) if (now - n.lastSeen > GONE_MS) { seen.delete(id); dropped = true; }
      if (dropped) onChange(list());
    }, 3000);
    sweep.unref?.();
  }

  function stop() {
    clearInterval(beacon);
    clearInterval(sweep);
    announce(true);            // so a neighbour drops us at once instead of waiting
    try { sock && sock.close(); } catch { /* going away anyway */ }
    sock = null;
  }

  return { start, stop, list, me: () => me };
}
