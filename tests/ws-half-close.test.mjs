// A peer that closes its side of a websocket is gone at once, even when nothing is ever sent
// to it. Node's http server hands an upgrade over half open, so a closed peer is an 'end' and
// no 'close' until something is written into it - and once the sea stopped sending its
// islanders anything, a dropped islander stayed `live` until the next ping
// (tests/animal-recovery.test.mjs found it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createWsServer } from '../lib/ws.mjs';

test('a peer that ends its side of the socket is closed straight away, with nothing sent to it', async (t) => {
  const server = http.createServer();
  let closed = null;
  let opened = null;
  let conn = null;
  const ready = new Promise((res) => { opened = res; });
  const gone = new Promise((res) => { closed = res; });
  createWsServer(server, { pingMs: 60000, onOpen: (c) => { conn = c; opened(); }, onClose: (c, code) => closed(code) });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  // Without the fix the server's half of the socket stays open and keeps server.close waiting:
  // close it from this side first, so a failure fails instead of hanging.
  t.after(() => { try { conn?.close(); } catch { /* gone */ } return new Promise((res) => server.close(() => res())); });
  const { port } = server.address();

  const sock = net.connect(port, '127.0.0.1');
  t.after(() => sock.destroy());
  sock.write([
    'GET /ws HTTP/1.1',
    `Host: 127.0.0.1:${port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version: 13',
    '', '',
  ].join('\r\n'));
  await ready;

  const at = Date.now();
  sock.end();   // FIN only: the half close a dropped line or a stopped islander looks like
  const code = await Promise.race([gone, new Promise((res) => setTimeout(() => res('timeout'), 2000))]);
  assert.notEqual(code, 'timeout', 'the server never noticed the peer had gone');
  assert.ok(Date.now() - at < 2000);
});
