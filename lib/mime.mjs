// What a message actually says, once the encodings are off it.
//
// Mail arrives as bytes with three layers between them and a sentence: the transfer
// encoding, the charset, and the multipart tree that decides which of the two or three
// copies of the same message was the one meant for a person to read. None of it is hard
// and all of it is fiddly, which is exactly the shape of thing this island writes out by
// hand rather than takes a dependency for - see lib/ws.mjs, which does the same for a
// WebSocket frame.
//
// Everything here is defensive on purpose. This is the one file in the village that
// parses something a stranger wrote: a header may be truncated mid-word, a boundary may
// never close, a charset may be a name no decoder has heard of. Nothing throws. A part
// that cannot be read comes back as the empty string and the message still opens.

// The charsets a browser is required to know are the charsets Node's TextDecoder knows,
// which is every one mail has used in thirty years. An unknown label is not worth an
// error - us-ascii text decoded as utf-8 is still the same text - so it falls back.
export function decodeBytes(buf, charset) {
  const name = String(charset || 'utf-8').trim().toLowerCase() || 'utf-8';
  try { return new TextDecoder(name, { fatal: false }).decode(buf); } catch { /* unknown label */ }
  try { return new TextDecoder('utf-8', { fatal: false }).decode(buf); } catch { return buf.toString('latin1'); }
}

// =?utf-8?B?...?= and =?iso-8859-1?Q?...?= - a header field with anything but ASCII in
// it. Adjacent encoded words are joined without the whitespace between them, which is
// the rule that keeps a subject split across two of them from growing a gap.
export function decodeWords(s) {
  const str = String(s == null ? '' : s);
  if (!str.includes('=?')) return str;
  let out = '';
  let last = 0;
  let previousWasWord = false;
  const re = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g;
  let m;
  while ((m = re.exec(str))) {
    const between = str.slice(last, m.index);
    if (!(previousWasWord && /^\s*$/.test(between))) out += between;
    const charset = m[1];
    const kind = m[2].toLowerCase();
    // Q is quoted-printable with one extra rule: an underscore is a space.
    const bytes = kind === 'b'
      ? Buffer.from(m[3], 'base64')
      : decodeQuoted(m[3].replace(/_/g, ' '), true);
    out += decodeBytes(bytes, charset);
    last = m.index + m[0].length;
    previousWasWord = true;
  }
  return out + str.slice(last);
}

// Quoted-printable, as bytes in and bytes out: =3D is a byte, not a character, and
// turning it into one before the charset is known would mangle every accented letter in
// a windows-1252 message. `inWord` drops the soft line break rule, which an encoded word
// has no room for anyway.
export function decodeQuoted(input, inWord = false) {
  const s = typeof input === 'string' ? input : input.toString('latin1');
  const out = Buffer.alloc(s.length);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '=') { out[n++] = s.charCodeAt(i) & 0xff; continue; }
    const pair = s.slice(i + 1, i + 3);
    if (!inWord && /^\r?\n/.test(s.slice(i + 1))) {        // a soft break: the line goes on
      i += s[i + 1] === '\r' ? 2 : 1;
      continue;
    }
    if (/^[0-9a-fA-F]{2}$/.test(pair)) { out[n++] = parseInt(pair, 16); i += 2; continue; }
    out[n++] = 0x3d;                                       // a lone = is a lone =
  }
  return out.subarray(0, n);
}

// Headers off the top, the rest is the body. The blank line between them is the whole
// format, and a message with no blank line at all is all header and no body.
export function splitHeaders(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8');
  let end = buf.indexOf('\r\n\r\n');
  let skip = 4;
  if (end < 0) { end = buf.indexOf('\n\n'); skip = 2; }
  if (end < 0) return { head: buf.toString('latin1'), body: Buffer.alloc(0) };
  return { head: buf.subarray(0, end).toString('latin1'), body: buf.subarray(end + skip) };
}

// name -> the values under it, lowercased keys, folded lines joined. An array per name
// because Received turns up a dozen times, even though everything the mailbox reads
// takes the first.
export function parseHeaders(head) {
  const out = new Map();
  let name = null;
  for (const line of String(head).replace(/\r\n/g, '\n').split('\n')) {
    if (/^[ \t]/.test(line) && name) {
      const held = out.get(name);
      held[held.length - 1] += ` ${line.trim()}`;
      continue;
    }
    const i = line.indexOf(':');
    if (i < 0) continue;
    name = line.slice(0, i).trim().toLowerCase();
    if (!out.has(name)) out.set(name, []);
    out.get(name).push(line.slice(i + 1).trim());
  }
  return out;
}

export function header(headers, name) {
  const v = headers.get(String(name).toLowerCase());
  return v && v.length ? v[0] : '';
}

// Content-Type: multipart/mixed; boundary="=_x" - the type, and whatever was hung off it
// with the quotes taken back off.
export function parseParams(value) {
  const s = String(value || '');
  const semi = s.indexOf(';');
  const type = (semi < 0 ? s : s.slice(0, semi)).trim().toLowerCase();
  const params = {};
  const re = /;\s*([\w!#$%&'*+.^`|~-]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^;]*)/g;
  let m;
  while ((m = re.exec(s))) {
    let v = m[2].trim();
    if (v.startsWith('"')) v = v.slice(1, -1).replace(/\\(.)/g, '$1');
    params[m[1].toLowerCase()] = v;
  }
  return { type, params };
}

// "Jansen, Jan" <jan@example.com>, piet@example.com - and the lists of both. Split by
// hand rather than on every comma, because a display name may hold one and the quotes
// around it are the only thing that says so.
export function addresses(value) {
  const s = decodeWords(value);
  const out = [];
  let buf = '';
  let quoted = false, angle = false;
  for (const ch of s) {
    if (ch === '"') { quoted = !quoted; buf += ch; continue; }
    if (!quoted && ch === '<') angle = true;
    if (!quoted && ch === '>') angle = false;
    if (ch === ',' && !quoted && !angle) { if (buf.trim()) out.push(oneAddress(buf)); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(oneAddress(buf));
  return out;
}

function oneAddress(s) {
  const str = s.trim();
  const m = /^(.*)<([^>]*)>\s*$/.exec(str);
  if (!m) return { name: '', address: str };
  let name = m[1].trim();
  if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1).replace(/\\(.)/g, '$1');
  return { name, address: m[2].trim() };
}

// Who a line in the inbox is from, in as few words as will still identify them.
export function displayName(addr) {
  if (!addr) return '';
  return addr.name || addr.address || '';
}

const MAX_PARTS = 60;          // a message nesting deeper than this is a bomb, not a mail

// The readable half of a message: the plain text if it sent one, the HTML if that is all
// there was, and the names of whatever else was hanging off it.
//
// A multipart/alternative sends the same words twice and the richest copy is meant to
// win, but the island reads its mail as text on a board, so the plain copy wins whenever
// there is one. The HTML is kept as a fallback and stripped on the way to the screen
// rather than hung in the page: nothing a stranger wrote is ever handed to innerHTML.
export function readableBody(raw) {
  const found = { text: '', html: '', attachments: [] };
  walk(raw, found, 0);
  return found;
}

function walk(raw, found, depth) {
  if (depth > 8 || found.attachments.length >= MAX_PARTS) return;
  const { head, body } = splitHeaders(raw);
  const headers = parseHeaders(head);
  const ct = parseParams(header(headers, 'content-type') || 'text/plain');
  const disposition = parseParams(header(headers, 'content-disposition'));
  const filename = disposition.params.filename || ct.params.name || '';

  if (ct.type.startsWith('multipart/')) {
    if (!ct.params.boundary) return;
    for (const part of splitParts(body, ct.params.boundary)) walk(part, found, depth + 1);
    return;
  }

  const decoded = decodeTransfer(body, header(headers, 'content-transfer-encoding'));
  const attached = disposition.type === 'attachment' || !ct.type.startsWith('text/');
  if (attached) {
    found.attachments.push({ name: decodeWords(filename) || ct.type, type: ct.type, bytes: decoded.length });
    return;
  }
  if (ct.type === 'text/html') { if (!found.html) found.html = decodeBytes(decoded, ct.params.charset); return; }
  if (!found.text) found.text = decodeBytes(decoded, ct.params.charset);
}

export function decodeTransfer(body, encoding) {
  const enc = String(encoding || '').trim().toLowerCase();
  if (enc === 'base64') return Buffer.from(body.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (enc === 'quoted-printable') return decodeQuoted(body);
  return body;
}

// The parts between the --boundary lines. A part whose boundary never closes is still
// handed back: a message that arrived half-written should show the half that arrived.
function splitParts(body, boundary) {
  const marker = Buffer.from(`--${boundary}`, 'latin1');
  const parts = [];
  let at = body.indexOf(marker);
  if (at < 0) return parts;
  while (at >= 0 && parts.length < MAX_PARTS) {
    const after = at + marker.length;
    if (body.subarray(after, after + 2).toString('latin1') === '--') break;      // the closing one
    const start = skipLine(body, after);
    const next = body.indexOf(marker, start);
    parts.push(body.subarray(start, next < 0 ? body.length : trimEol(body, next)));
    if (next < 0) break;
    at = next;
  }
  return parts;
}

const skipLine = (buf, from) => {
  const nl = buf.indexOf(0x0a, from);
  return nl < 0 ? buf.length : nl + 1;
};
const trimEol = (buf, at) => {
  let end = at;
  if (end > 0 && buf[end - 1] === 0x0a) end--;
  if (end > 0 && buf[end - 1] === 0x0d) end--;
  return end;
};

// HTML down to something a plain board can show. Not a renderer and not trying to be:
// script and style go, the block tags become line breaks, the entities come back, and
// what is left is the words in the order they were written.
export function htmlToText(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---- writing one ------------------------------------------------------------------
// The other direction, which is the smaller half because the island only ever sends one
// shape of message: utf-8 text, base64, a single part.

// A header value with anything but ASCII in it goes out as encoded words. Cut on a
// character boundary rather than every 45 bytes, which is what would put half of an
// e-acute in one word and half in the next.
export function encodeHeader(value) {
  const s = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const words = [];
  let held = '';
  for (const ch of s) {
    if (Buffer.byteLength(held + ch, 'utf8') > 39) { words.push(held); held = ''; }
    held += ch;
  }
  if (held) words.push(held);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ');
}

export function base64Body(text) {
  const b64 = Buffer.from(String(text == null ? '' : text), 'utf8').toString('base64');
  const lines = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join('\r\n');
}

// Date: as RFC 5322 spells it, in the island's own offset. Node has no formatter for
// this - toUTCString() is the previous century's wording - so it is written out.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function mailDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const zone = `${off < 0 ? '-' : '+'}${p(Math.floor(Math.abs(off) / 60))}${p(Math.abs(off) % 60)}`;
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${zone}`;
}
