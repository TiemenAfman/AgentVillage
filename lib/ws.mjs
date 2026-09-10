// A WebSocket server, hand-written on the http server the island already runs. The repo
// carries no runtime dependencies and this is small enough to keep it that way.
//
// We only ever send short JSON text frames, so everything else - binary, fragments,
// compression - is refused instead of implemented. Refusing is safe rather than lazy:
// browsers do not fragment a small send(), and an extension we never echo in the
// handshake is never negotiated, so permessage-deflate can never arrive.
//
// This file knows nothing about players or the island. That is deliberate: it can be
// driven by a raw socket script, which is the only way to test the awkward cases.
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const CLOSE = {
  normal: 1000,
  protocol: 1002,
  unsupported: 1003,
  policy: 1008,
  tooBig: 1009,
  overloaded: 1013,
};

// Server frames are never masked, so a header is two, four or ten bytes and then the
// payload. The ten-byte form only appears past 64 KB, which our messages never reach.
function encode(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = 0x80 | opcode;   // FIN, no reserved bits
  return Buffer.concat([header, payload]);
}

function closeFrame(code, reason = '') {
  const body = Buffer.alloc(2 + Buffer.byteLength(reason));
  body.writeUInt16BE(code, 0);
  body.write(reason, 2);
  return encode(0x8, body);
}

// Reads one frame off the front of buf. Returns null when the bytes are not all here
// yet - TCP splits and coalesces frames, and getting that wrong is the classic bug in a
// hand-written implementation. An oversized length is rejected from the header alone, so
// a client claiming four gigabytes never gets a buffer allocated for it.
function readFrame(buf, maxPayload) {
  if (buf.length < 2) return null;
  const b0 = buf[0], b1 = buf[1];
  const fin = (b0 & 0x80) !== 0;
  const rsv = b0 & 0x70;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let off = 2;

  if (rsv) return { error: 'reserved bits set', code: CLOSE.protocol };
  if (opcode >= 0x8 && (!fin || len > 125)) return { error: 'bad control frame', code: CLOSE.protocol };

  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    // A Node buffer cannot hold four gigabytes and we would not want to hold it anyway:
    // refuse the high half outright rather than silently truncating it.
    if (buf.readUInt32BE(2) !== 0) return { error: 'frame too large', code: CLOSE.tooBig };
    len = buf.readUInt32BE(6);
    off = 10;
  }
  if (len > maxPayload) return { error: 'frame too large', code: CLOSE.tooBig };
  if (!masked) return { error: 'client frames must be masked', code: CLOSE.protocol };

  if (buf.length < off + 4) return null;
  const mask = buf.subarray(off, off + 4);
  off += 4;
  if (buf.length < off + len) return null;

  const payload = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) payload[i] = buf[off + i] ^ mask[i & 3];
  return { fin, opcode, payload, rest: buf.subarray(off + len) };
}

function headerHas(value, token) {
  return String(value || '').toLowerCase().split(',').some((s) => s.trim() === token);
}

export function createWsServer(server, {
  path = '/ws',
  isAllowed = () => true,
  maxPayload = 2048,
  maxSockets = 32,
  pingMs = 25000,
  onOpen = () => {},
  onMessage = () => {},
  onClose = () => {},
  log = () => {},
} = {}) {
  const conns = new Set();

  function refuse(socket, status, text, extra = '') {
    try { socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n${extra}\r\n`); } catch { /* gone */ }
    socket.destroy();
  }

  server.on('upgrade', (req, socket, head) => {
    let p = '';
    try { p = new URL(req.url, 'http://island').pathname; } catch { p = ''; }
    if (p !== path) return refuse(socket, 404, 'Not Found');
    if (req.method !== 'GET') return refuse(socket, 405, 'Method Not Allowed');
    if (!headerHas(req.headers.connection, 'upgrade') || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      return refuse(socket, 400, 'Bad Request');
    }
    if (String(req.headers['sec-websocket-version']) !== '13') {
      return refuse(socket, 426, 'Upgrade Required', 'Sec-WebSocket-Version: 13\r\n');
    }
    const key = String(req.headers['sec-websocket-key'] || '');
    if (!/^[A-Za-z0-9+/]{22}==$/.test(key)) return refuse(socket, 400, 'Bad Request');
    // The upgrade event is a second front door: handle() in serve.mjs never sees these
    // requests, so the same trust check has to be made again, here, by hand.
    if (!isAllowed(req)) return refuse(socket, 403, 'Forbidden');
    if (conns.size >= maxSockets) return refuse(socket, 503, 'Service Unavailable');

    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    // No Sec-WebSocket-Extensions and no Sec-WebSocket-Protocol in the reply: not
    // echoing them is what keeps compression out of the picture entirely.
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.setNoDelay(true);
    socket.setTimeout(0);

    let buf = Buffer.alloc(0);
    let closing = false;
    let backedUpSince = 0;

    const conn = {
      id: crypto.randomBytes(6).toString('hex'),
      remote: socket.remoteAddress || '',
      headers: req.headers,
      data: {},
      lastPong: Date.now(),
      // Returns false when the frame was dropped. At fifteen snapshots a second,
      // dropping one is always better than queueing it behind a stalled client.
      send(text) {
        if (closing || socket.destroyed) return false;
        if (socket.writableLength > 64 * 1024) {
          if (!backedUpSince) backedUpSince = Date.now();
          else if (Date.now() - backedUpSince > 5000) conn.close(CLOSE.overloaded, 'too slow');
          return false;
        }
        backedUpSince = 0;
        try { socket.write(encode(0x1, Buffer.from(text, 'utf8'))); return true; } catch { return false; }
      },
      ping() {
        if (closing || socket.destroyed) return;
        try { socket.write(encode(0x9, Buffer.alloc(0))); } catch { /* gone */ }
      },
      close(code = CLOSE.normal, reason = '') {
        if (closing) return;
        closing = true;
        try { socket.write(closeFrame(code, reason)); } catch { /* gone */ }
        socket.end();
        // A client that never answers our close must not hold a socket forever.
        setTimeout(() => socket.destroy(), 2000).unref?.();
      },
    };

    const finish = (code) => {
      if (!conns.delete(conn)) return;   // only ever report the close once
      try { onClose(conn, code); } catch (e) { log(`ws close handler failed: ${e && e.message}`); }
    };

    const fail = (code, why) => {
      log(`ws ${conn.id} refused: ${why}`);
      conn.close(code, why);
      finish(code);
    };

    function handleFrame(f) {
      switch (f.opcode) {
        case 0x1:
          if (!f.fin) { fail(CLOSE.tooBig, 'fragmented message'); return false; }
          try { onMessage(conn, f.payload.toString('utf8')); } catch (e) { log(`ws message handler failed: ${e && e.message}`); }
          return true;
        case 0x9:
          try { socket.write(encode(0xa, f.payload)); } catch { /* gone */ }
          return true;
        case 0xa:
          conn.lastPong = Date.now();
          return true;
        case 0x8:
          conn.close(CLOSE.normal);
          finish(CLOSE.normal);
          return false;
        case 0x2:
          fail(CLOSE.unsupported, 'binary frames are not spoken here');
          return false;
        case 0x0:
          fail(CLOSE.tooBig, 'fragmented message');
          return false;
        default:
          fail(CLOSE.protocol, `opcode ${f.opcode}`);
          return false;
      }
    }

    function feed(chunk) {
      if (closing) return;
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      for (;;) {
        const f = readFrame(buf, maxPayload);
        if (f === null) {
          // Nothing whole yet. A partial frame bigger than a whole one can ever be is a
          // client ignoring the limit, not a slow network.
          if (buf.length > maxPayload + 14) fail(CLOSE.tooBig, 'frame too large');
          return;
        }
        if (f.error) { fail(f.code, f.error); return; }
        buf = f.rest;
        if (!handleFrame(f)) return;
      }
    }

    socket.on('data', feed);
    socket.on('error', () => finish(CLOSE.protocol));
    socket.on('close', () => finish(CLOSE.normal));

    conns.add(conn);
    try { onOpen(conn, req); } catch (e) { log(`ws open handler failed: ${e && e.message}`); }
    // A fast client can pipeline its first frame into the upgrade request itself.
    if (head && head.length) feed(head);
  });

  // Liveness rides on protocol pings, which the browser answers without waking any
  // JavaScript. That matters: a backgrounded tab stops its animation frames, so an
  // application-level heartbeat would drop exactly the players who are still there.
  const beat = setInterval(() => {
    const now = Date.now();
    for (const c of conns) {
      if (now - c.lastPong > pingMs * 2.5) { c.close(CLOSE.policy, 'no pong'); continue; }
      c.ping();
    }
  }, pingMs);
  beat.unref?.();

  return {
    size: () => conns.size,
    each: (fn) => { for (const c of conns) fn(c); },
    broadcast: (text) => { for (const c of conns) c.send(text); },
    close: () => {
      clearInterval(beat);
      for (const c of conns) c.close(CLOSE.normal, 'island closing');
    },
  };
}
