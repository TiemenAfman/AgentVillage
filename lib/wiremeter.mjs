// What the sea says, counted: messages and bytes out per message type, since it started.
//
// In memory, like everything the sea holds - a restart starts the count again, which is what
// `since` is for. Read off /health (`wire`), so the rate is two readings apart divided by the
// time between them; nothing here keeps a window or a timer of its own. Counted where every
// frame leaves - each socket's `send`, wrapped once when it opens - rather than at the dozen
// places that build a message, so nothing that is sent can be missed by a new message type.
//
// Bytes are the JSON text's length, not the frame's: a frame adds two to four bytes of header
// and the text is ASCII but for a name or a sentence somebody typed. Close enough to compare
// two message types or two versions of the sea, which is what it is for
// (Plans/zee-stuurt-wat-je-ziet.md).

// Every message the sea builds is `JSON.stringify({ t: ..., ... })`, so the type is the
// first string in the text. Read without parsing: this runs on every frame of every socket.
const HEAD = '{"t":"';
export function typeOf(text) {
  if (typeof text !== 'string' || !text.startsWith(HEAD)) return '?';
  const end = text.indexOf('"', HEAD.length);
  return end > HEAD.length && end - HEAD.length <= 16 ? text.slice(HEAD.length, end) : '?';
}

export function createWireMeter({ now = () => Date.now() } = {}) {
  const since = now();
  const types = new Map();   // type -> { msgs, bytes }
  let msgs = 0, bytes = 0;

  function count(text) {
    const t = typeOf(text);
    let row = types.get(t);
    if (!row) types.set(t, (row = { msgs: 0, bytes: 0 }));
    row.msgs++;
    row.bytes += text.length;
    msgs++;
    bytes += text.length;
  }

  // Wraps a connection's send so every frame it carries is counted - only the ones that went:
  // lib/ws.mjs drops a frame to a client that has fallen behind and says so by returning false.
  function watch(conn) {
    const send = conn.send.bind(conn);
    conn.send = (text) => {
      const ok = send(text);
      if (ok !== false) count(text);
      return ok;
    };
    return conn;
  }

  function snapshot() {
    const out = {};
    for (const [t, r] of [...types].sort((a, b) => b[1].bytes - a[1].bytes)) out[t] = { ...r };
    return { since, msgs, bytes, types: out };
  }

  return { watch, count, snapshot };
}
