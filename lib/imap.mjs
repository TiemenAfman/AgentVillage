// IMAP, by hand, over a socket.
//
// The island has no runtime dependencies and this is not the file to start with: what the
// mailbox needs is five commands - log in, open the inbox, count what is unread, fetch a
// page of headers, fetch one message - and a client for all of IMAP would be a hundred
// times the size of that. lib/ws.mjs made the same call about WebSocket frames and for
// the same reason.
//
// The protocol itself is a line at a time. You write "a7 SELECT INBOX", the server writes
// any number of untagged "* ..." lines back and then "a7 OK" with your own tag on it, and
// that tag is how you know the answer is yours. The one wrinkle is the literal: a line may
// end in {247}, which means the next 247 bytes are part of this line and may hold anything
// at all, newlines included. Everything awkward here is that wrinkle.
import net from 'node:net';
import tls from 'node:tls';
import { parseHeaders } from './mime.mjs';

const CRLF = '\r\n';
// A mailbox on the other side of a slow line still has to answer eventually. Long enough
// that a big fetch over a domestic uplink is not cut off, short enough that a wrong port
// tells you so while you are still standing at the box.
const TIMEOUT_MS = 25000;
// How much of one message the island will read. A mail with a video in it is not a mail
// the mailbox can show, and pulling ten megabytes over the wire to throw them away is
// worse than saying so. Past this the fetch asks for the opening slice only.
const MAX_BODY = 2 * 1024 * 1024;

// A whole IMAP response line, with its literals lifted out. The literals are replaced in
// the text by \u0000<n>\u0000 - a byte no IMAP response ever contains - so that a regex
// over the text cannot walk into somebody's message body and find a word like UID in it.
const MARK = (n) => `\u0000${n}\u0000`;

class Conn {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.gone = null;
    this.waiter = null;
    this.n = 0;
    sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.wake(); });
    sock.on('error', (e) => { this.gone = this.gone || e; this.wake(); });
    sock.on('close', () => { this.gone = this.gone || new Error('the mail server closed the connection'); this.wake(); });
  }

  wake() { const w = this.waiter; this.waiter = null; if (w) w(); }

  // Waits for the next thing to happen on the socket, or gives up. The timer is cleared
  // on every wake, so a fetch that keeps arriving keeps its time.
  more() {
    if (this.gone) throw this.gone;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.gone = new Error('the mail server stopped answering');
        this.sock.destroy();
        reject(this.gone);
      }, TIMEOUT_MS);
      this.waiter = () => { clearTimeout(timer); resolve(); };
    });
  }

  async readLine() {
    for (;;) {
      const i = this.buf.indexOf(0x0a);
      if (i >= 0) {
        const line = this.buf.subarray(0, i).toString('latin1').replace(/\r$/, '');
        this.buf = this.buf.subarray(i + 1);
        return line;
      }
      if (this.gone) throw this.gone;
      await this.more();
    }
  }

  async readBytes(n) {
    while (this.buf.length < n) {
      if (this.gone) throw this.gone;
      await this.more();
    }
    const out = Buffer.from(this.buf.subarray(0, n));
    this.buf = this.buf.subarray(n);
    return out;
  }

  // One logical line: everything up to the newline that is not inside a literal.
  async readResponse() {
    let text = '';
    const literals = [];
    for (;;) {
      const line = await this.readLine();
      const m = /\{(\d+)\+?\}$/.exec(line);
      if (!m) { text += line; return { text, literals }; }
      text += line.slice(0, m.index) + MARK(literals.length);
      literals.push(await this.readBytes(Number(m[1])));
      if (literals.length > 64) throw new Error('the mail server sent more than this can hold');
    }
  }

  write(s) {
    if (this.gone) throw this.gone;
    this.sock.write(s);
  }

  // Sends one command and collects everything the server says about it. `onPlus` is for
  // the two commands that are a conversation rather than a line - APPEND sends its
  // message only once the server has said it is ready for it.
  async command(cmd, onPlus = null) {
    const tag = `a${++this.n}`;
    this.write(`${tag} ${cmd}${CRLF}`);
    const untagged = [];
    for (;;) {
      const r = await this.readResponse();
      if (r.text.startsWith('+')) {
        if (!onPlus) throw new Error('the mail server asked for more than this command has');
        await onPlus(this);
        continue;
      }
      if (r.text.startsWith(`${tag} `)) {
        const [, status, rest] = /^\S+ (\w+)\s*(.*)$/.exec(r.text) || [];
        if (String(status).toUpperCase() !== 'OK') throw new Error(said(rest) || `the mail server said ${status}`);
        return { untagged, text: rest || '' };
      }
      untagged.push(r);
    }
  }

  end() {
    try { this.sock.destroy(); } catch { /* already gone */ }
  }
}

// What the server said, without the [BRACKETED CODE] a person cannot act on - except
// that the code is sometimes the only thing there, in which case it is the message.
function said(text) {
  const s = String(text || '').trim();
  const bare = s.replace(/^\[[^\]]*\]\s*/, '').trim();
  return bare || s;
}

const quote = (s) => `"${String(s).replace(/([\\"])/g, '\\$1')}"`;

// ---- opening one ------------------------------------------------------------------

// Connects, logs in, and hands back something that can be asked questions. `secure` is
// implicit TLS on 993; anything else starts in the clear and is lifted with STARTTLS if
// the server offers it, because a password over a plain socket is not something this
// should do quietly.
export async function openImap({ host, port, secure = true, user, pass, insecure = false }) {
  const where = String(host || '').trim();
  if (!where) throw new Error('no IMAP server to talk to');
  const at = Number(port) || (secure ? 993 : 143);

  let sock = await connect(where, at, secure, insecure);
  let conn = new Conn(sock);
  const greeting = await conn.readResponse();
  if (!/^\*\s+(OK|PREAUTH)/i.test(greeting.text)) {
    conn.end();
    throw new Error(`${where} did not greet us: ${said(greeting.text.replace(/^\*\s*/, ''))}`);
  }

  if (!secure) {
    const caps = await conn.command('CAPABILITY');
    const line = caps.untagged.map((u) => u.text).join(' ').toUpperCase();
    if (!line.includes('STARTTLS')) {
      conn.end();
      throw new Error(`${where}:${at} offers no encryption. Use SSL on 993, or a server that has STARTTLS.`);
    }
    await conn.command('STARTTLS');
    sock = await upgrade(sock, where, insecure);
    conn = new Conn(sock);
  }

  try {
    await conn.command(`LOGIN ${quote(user)} ${quote(pass)}`);
  } catch (e) {
    conn.end();
    throw new Error(`${where} refused the login: ${e.message}`);
  }

  let box = null;
  // What the server says it can do, asked once and kept. Only one answer is acted on:
  // X-GM-EXT-1 is Gmail, and Gmail files a copy of anything sent through its own SMTP in
  // Sent Mail by itself - so filing one over IMAP as well would put every reply in there
  // twice. See `send` in lib/mail.mjs.
  let caps = '';
  try { caps = (await conn.command('CAPABILITY')).untagged.map((u) => u.text).join(' ').toUpperCase(); } catch { /* an old server; nothing here is required */ }

  return {
    get alive() { return !conn.gone; },
    get gmail() { return caps.includes('X-GM-EXT-1'); },

    // Opening the inbox is what makes everything below mean anything. Read-write, so a
    // message can be marked as read; the poll that raises the flag opens it too and
    // simply never writes a flag.
    async select(mailbox = 'INBOX') {
      const r = await conn.command(`SELECT ${quote(mailbox)}`);
      let exists = 0;
      for (const u of r.untagged) {
        const m = /^\*\s+(\d+)\s+EXISTS/i.exec(u.text);
        if (m) exists = Number(m[1]);
      }
      box = { name: mailbox, exists };
      return box;
    },

    // How many are unread, which is the only question the flag on the box asks. SEARCH
    // rather than STATUS: the mailbox is already open by the time this is wanted, and a
    // STATUS on the open mailbox is the one thing the standard tells you not to do.
    async unseen() {
      const r = await conn.command('SEARCH UNSEEN');
      let n = 0;
      for (const u of r.untagged) {
        const m = /^\*\s+SEARCH\b(.*)$/i.exec(u.text);
        if (m) n += m[1].trim() ? m[1].trim().split(/\s+/).length : 0;
      }
      return n;
    },

    // The last `limit` messages, newest first. By sequence number rather than by date:
    // the server keeps them in arrival order, so the tail of that order is the top of the
    // inbox and no search is needed to find it.
    async page({ limit = 25 } = {}) {
      if (!box) await this.select();
      if (!box.exists) return [];
      const from = Math.max(1, box.exists - limit + 1);
      const fields = 'BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID REFERENCES)]';
      const r = await conn.command(`FETCH ${from}:${box.exists} (UID FLAGS INTERNALDATE RFC822.SIZE ${fields})`);
      const out = [];
      for (const u of r.untagged) {
        const one = fetchLine(u);
        if (one) out.push(one);
      }
      out.sort((a, b) => b.seq - a.seq);
      return out;
    },

    // One message, and never more of one than the box will show. The partial fetch is
    // asked for every time rather than only for the messages we already know are big:
    // a shorter message comes back whole regardless, and a mail with a film in it can
    // then never pull ten megabytes over the wire for the two paragraphs at the top.
    async message(uid) {
      const r = await conn.command(`UID FETCH ${Number(uid)} (BODY.PEEK[]<0.${MAX_BODY}>)`);
      for (const u of r.untagged) {
        if (!/\bFETCH\b/i.test(u.text) || !u.literals.length) continue;
        const raw = u.literals[u.literals.length - 1];
        // Exactly the limit means the slice ran out, not that the message happened to
        // end there - near enough, and the only thing it costs is one honest line on a
        // message that is precisely two megabytes long.
        return { raw, truncated: raw.length >= MAX_BODY };
      }
      throw new Error('that message is no longer in the inbox');
    },

    async flag(uid, flag, on = true) {
      await conn.command(`UID STORE ${Number(uid)} ${on ? '+' : '-'}FLAGS (${flag})`);
    },

    // Where a copy of what you sent belongs. Special-use first, because that is the
    // server saying it itself; the names after it are what a server without special-use
    // calls the same folder in the two languages this island is written in.
    async sentFolder() {
      const r = await conn.command('LIST "" "*"');
      const rows = [];
      for (const u of r.untagged) {
        const m = /^\*\s+LIST\s+\(([^)]*)\)\s+(?:"[^"]*"|NIL)\s+(.*)$/i.exec(u.text);
        if (!m) continue;
        let name = m[2].trim();
        if (name.startsWith('"')) name = name.slice(1, -1).replace(/\\(.)/g, '$1');
        else if (name.startsWith('\u0000')) name = literalOf(u, name);
        rows.push({ attrs: m[1].toLowerCase(), name });
      }
      const special = rows.find((x) => x.attrs.includes('\\sent'));
      if (special) return special.name;
      const known = /^(sent|sent items|sent mail|verzonden items|verzonden)$/i;
      const named = rows.find((x) => known.test(x.name.split(/[/.]/).pop().trim()));
      return named ? named.name : null;
    },

    // A copy of an outgoing message, filed. Best effort on purpose: a reply that was
    // delivered but not filed is still a reply that was delivered, so the caller logs
    // this failing and says nothing to the reader.
    async append(mailbox, raw) {
      const body = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8');
      await conn.command(`APPEND ${quote(mailbox)} (\\Seen) {${body.length}}`, async (c) => {
        c.sock.write(body);
        c.write(CRLF);
      });
    },

    async logout() {
      try { await conn.command('LOGOUT'); } catch { /* the line was going anyway */ }
      conn.end();
    },

    close() { conn.end(); },
  };
}

// * 12 FETCH (UID 345 FLAGS (\Seen) INTERNALDATE "17-Sep-2026 12:00:00 +0200" ... {247}
// ...and the headers themselves in the literal. Read with four small regexes rather than
// a parser for IMAP's parenthesised lists: the fields are the ones we asked for, in the
// shapes the standard fixes, and nothing a stranger wrote can reach the text - see MARK.
function fetchLine(u) {
  const seq = /^\*\s+(\d+)\s+FETCH\b/i.exec(u.text);
  if (!seq) return null;
  const uid = /\bUID\s+(\d+)/i.exec(u.text);
  const flags = /\bFLAGS\s+\(([^)]*)\)/i.exec(u.text);
  const when = /\bINTERNALDATE\s+"([^"]*)"/i.exec(u.text);
  const size = /\bRFC822\.SIZE\s+(\d+)/i.exec(u.text);
  const headers = parseHeaders((u.literals[0] || Buffer.alloc(0)).toString('latin1'));
  const flagList = (flags ? flags[1] : '').toLowerCase().split(/\s+/).filter(Boolean);
  return {
    seq: Number(seq[1]),
    uid: uid ? Number(uid[1]) : null,
    size: size ? Number(size[1]) : 0,
    seen: flagList.includes('\\seen'),
    answered: flagList.includes('\\answered'),
    flagged: flagList.includes('\\flagged'),
    internalDate: when ? when[1] : '',
    headers,
  };
}

// A mailbox name the server sent as a literal rather than as a quoted string, which is
// what it does when the name has a character IMAP's quoting cannot carry.
function literalOf(u, marked) {
  const m = /^\u0000(\d+)\u0000/.exec(marked);
  return m && u.literals[Number(m[1])] ? u.literals[Number(m[1])].toString('utf8') : marked;
}

function connect(host, port, secure, insecure) {
  return new Promise((resolve, reject) => {
    const done = (e, s) => { clearTimeout(timer); e ? reject(e) : resolve(s); };
    const timer = setTimeout(() => done(new Error(`${host}:${port} did not answer`)), TIMEOUT_MS);
    const sock = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: !insecure }, () => done(null, sock))
      : net.connect({ host, port }, () => done(null, sock));
    sock.once('error', (e) => done(reachable(e, host, port)));
  });
}

// STARTTLS: the same socket, wrapped, once the server has agreed to it.
function upgrade(sock, host, insecure) {
  return new Promise((resolve, reject) => {
    const done = (e, s) => { clearTimeout(timer); e ? reject(e) : resolve(s); };
    const timer = setTimeout(() => done(new Error(`${host} did not finish the handshake`)), TIMEOUT_MS);
    sock.removeAllListeners('data');
    sock.removeAllListeners('error');
    sock.removeAllListeners('close');
    const up = tls.connect({ socket: sock, servername: host, rejectUnauthorized: !insecure }, () => done(null, up));
    up.once('error', (e) => done(e));
  });
}

// The three ways this fails before anything has been said, in words that name the thing
// to go and change rather than the errno.
export function reachable(e, host, port) {
  const code = e && e.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new Error(`there is no such server as ${host}`);
  if (code === 'ECONNREFUSED') return new Error(`${host} is not listening on port ${port}`);
  if (code === 'ETIMEDOUT') return new Error(`${host}:${port} never answered`);
  if ((code && String(code).startsWith('ERR_TLS')) || code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
    || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    // Worth naming the way out, because this one is nearly always an in-house server
    // whose certificate lapsed rather than anything sinister - and without the sentence
    // the reader is left with an errno and a form that looks right.
    return new Error(`${host} has a certificate this cannot check (${e.message}). `
      + 'If it is your own server, tick "take the certificate on trust".');
  }
  return e instanceof Error ? e : new Error(String(e));
}
