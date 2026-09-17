// The mailbox on the town hall pavement: whose mail it holds, and how it is fetched.
//
// This is the one part of the island that reaches off the machine, and the one that holds
// a password. Both of those set the rules everything below follows:
//
//   the file    - the accounts live in data/mail.json, which git has never tracked (see
//                 .gitignore, where it is named twice: once by the data/ rule that covers
//                 the village's own scratch files, and once on its own, because a rule
//                 somebody widens later must not quietly start publishing this).
//   the wire    - no password ever goes back to the browser. The panel is told that an
//                 account has one, never what it is, so a page left open on a second
//                 screen cannot be read for it.
//   the retry   - an account whose login is refused is put aside and not tried again until
//                 somebody saves it or asks for it by hand. A poll every half minute
//                 against a wrong password is how a work account gets locked out, and the
//                 mailbox on a village green is not worth that.
//
// The connection is kept warm between requests, because opening one costs a TLS handshake
// and a login, and the panel asks three questions in a row the moment you press E.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA, readJson, writeJsonAtomic } from './paths.mjs';
import { openImap } from './imap.mjs';
import { sendMail } from './smtp.mjs';
import { addresses, decodeWords, header, parseHeaders, readableBody, htmlToText, splitHeaders } from './mime.mjs';

export const MAIL_FILE = path.join(DATA, 'mail.json');

const MAX_ACCOUNTS = 8;
const IDLE_MS = 90 * 1000;          // how long a warm connection is worth keeping
const FRESH_MS = 45 * 1000;         // how old an unread count may be before it is asked again
const SULK_MS = 10 * 60 * 1000;     // how long an account that refused us is left alone

// ---- what is on disk ---------------------------------------------------------------

function load() {
  const on = readJson(MAIL_FILE, null);
  const accounts = (on && Array.isArray(on.accounts)) ? on.accounts : [];
  return accounts.filter((a) => a && a.id);
}

function save(accounts) {
  writeJsonAtomic(MAIL_FILE, { v: 1, savedAt: new Date().toISOString(), accounts }, { pretty: true });
}

const find = (id) => load().find((a) => a.id === String(id)) || null;

// What the browser is allowed to know about an account. Everything except the one field
// that matters, plus whether that field is set.
export function publicAccount(a) {
  return {
    id: a.id,
    label: a.label || a.address || a.id,
    address: a.address,
    name: a.name || '',
    user: a.user,
    imap: { ...a.imap },
    smtp: { ...a.smtp },
    insecure: !!a.insecure,
    hasPassword: !!a.pass,
  };
}

export function listAccounts() {
  return load().map(publicAccount);
}

const text = (v, max = 200) => String(v == null ? '' : v).replace(/[\r\n\u0000]/g, ' ').trim().slice(0, max);
const portOf = (v, fallback) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
};

// Reads a form into an account, refusing the four things that would make a later failure
// unreadable: no address, no server, no user, no password. A password left out of an
// update keeps the one on file, which is what lets the panel show a form it never had
// the password to fill.
export function readAccount(spec = {}, existing = null) {
  const address = text(spec.address, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('that is not an e-mail address');

  const imapHost = text(spec.imap && spec.imap.host, 120);
  if (!imapHost) throw new Error('say which server holds the mail');
  const smtpHost = text(spec.smtp && spec.smtp.host, 120) || imapHost;

  const imapSecure = spec.imap && spec.imap.secure !== undefined ? !!spec.imap.secure : true;
  const smtpSecure = spec.smtp && spec.smtp.secure !== undefined ? !!spec.smtp.secure : false;
  const pass = spec.pass === undefined || spec.pass === null || spec.pass === ''
    ? (existing ? existing.pass : '')
    : String(spec.pass).replace(/[\r\n\u0000]/g, '');
  if (!pass) throw new Error('the server will want a password');

  return {
    id: existing ? existing.id : `mail:${randomUUID().slice(0, 8)}`,
    label: text(spec.label, 40) || address,
    address,
    name: text(spec.name, 60),
    user: text(spec.user, 120) || address,
    pass,
    imap: { host: imapHost, port: portOf(spec.imap && spec.imap.port, imapSecure ? 993 : 143), secure: imapSecure },
    smtp: { host: smtpHost, port: portOf(spec.smtp && spec.smtp.port, smtpSecure ? 465 : 587), secure: smtpSecure },
    insecure: !!spec.insecure,
  };
}

export function saveAccount(spec = {}) {
  const accounts = load();
  const existing = spec.id ? accounts.find((a) => a.id === String(spec.id)) : null;
  if (spec.id && !existing) throw new Error('there is no account by that name any more');
  if (!existing && accounts.length >= MAX_ACCOUNTS) throw new Error(`the box holds ${MAX_ACCOUNTS} accounts, which is as many as it will take`);

  const made = readAccount(spec, existing || null);
  if (existing) accounts[accounts.indexOf(existing)] = made;
  else accounts.push(made);
  save(accounts);
  forget(made.id);                     // the settings changed, so the old line is no good
  return publicAccount(made);
}

export function removeAccount(id) {
  const accounts = load();
  const at = accounts.findIndex((a) => a.id === String(id));
  if (at < 0) return null;
  const [gone] = accounts.splice(at, 1);
  save(accounts);
  forget(gone.id);
  return publicAccount(gone);
}

// ---- the warm connection ------------------------------------------------------------
// One line per account, one job at a time on it. The chain is what stops the panel's
// three questions from interleaving on a protocol where the answers are told apart by the
// tag on the line and nothing else.

const lines = new Map();      // account id -> { session, at, chain, timer }
const state = new Map();      // account id -> { unread, at, error, sulkUntil }

function forget(id) {
  const held = lines.get(id);
  if (held) {
    clearTimeout(held.timer);
    if (held.session) held.session.close();
    lines.delete(id);
  }
  state.delete(id);
}

function idle(id) {
  const held = lines.get(id);
  if (!held) return;
  clearTimeout(held.timer);
  held.timer = setTimeout(() => {
    const now = lines.get(id);
    if (!now || Date.now() - now.at < IDLE_MS - 500) return;
    if (now.session) now.session.logout().catch(() => {});
    now.session = null;
  }, IDLE_MS);
  if (held.timer.unref) held.timer.unref();
}

// Runs one piece of work against an account's inbox, on a connection that is opened if
// there is none and reopened once if the one we had has died under us. A server that
// dropped an idle line while nobody was looking is the ordinary case, not an error worth
// showing, so the retry is silent - but only for a connection we inherited, never for one
// this call opened, or a refused login would be tried twice.
export async function withInbox(id, work) {
  const account = find(id);
  if (!account) throw new Error('there is no such account');
  const held = lines.get(id) || { session: null, at: 0, chain: Promise.resolve(), timer: null };
  lines.set(id, held);

  const run = async () => {
    let inherited = !!held.session;
    for (let attempt = 0; ; attempt++) {
      if (!held.session || !held.session.alive) {
        inherited = false;
        held.session = await openImap({ ...account.imap, user: account.user, pass: account.pass, insecure: account.insecure });
        await held.session.select('INBOX');
      }
      try {
        const out = await work(held.session, account);
        held.at = Date.now();
        idle(id);
        return out;
      } catch (e) {
        const dead = !held.session.alive;
        if (held.session) held.session.close();
        held.session = null;
        if (attempt === 0 && inherited && dead) continue;      // the idle line had gone; open a new one
        throw e;
      }
    }
  };

  // Every caller waits for the one before it, and a failure does not break the chain for
  // whoever is behind it.
  const queued = held.chain.then(run, run);
  held.chain = queued.then(() => {}, () => {});
  return queued;
}

// ---- what the panel asks for ---------------------------------------------------------

const ADDR = (v) => {
  const [first] = addresses(v);
  return first ? { name: first.name, address: first.address } : { name: '', address: '' };
};

// "17-Sep-2026 12:00:00 +0200", which is IMAP's own spelling and no Date's.
function internalDate(s) {
  const m = /^\s*(\d{1,2})-(\w{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})?/.exec(String(s || ''));
  if (!m) return null;
  const at = Date.parse(`${m[1]} ${m[2]} ${m[3]} ${m[4]}:${m[5]}:${m[6]} ${m[7] || '+0000'}`);
  return Number.isFinite(at) ? new Date(at) : null;
}

function whenOf(one) {
  const sent = Date.parse(header(one.headers, 'date'));
  if (Number.isFinite(sent)) return new Date(sent);
  return internalDate(one.internalDate) || null;
}

function summary(one) {
  const when = whenOf(one);
  return {
    uid: one.uid,
    seq: one.seq,
    seen: one.seen,
    answered: one.answered,
    flagged: one.flagged,
    size: one.size,
    from: ADDR(header(one.headers, 'from')),
    to: addresses(header(one.headers, 'to')).slice(0, 8),
    subject: decodeWords(header(one.headers, 'subject')) || '(no subject)',
    at: when ? when.toISOString() : null,
    messageId: header(one.headers, 'message-id'),
    references: header(one.headers, 'references'),
  };
}

export async function inbox(id, { limit = 25 } = {}) {
  return withInbox(id, async (session) => {
    const box = await session.select('INBOX');
    const page = await session.page({ limit: Math.min(100, Math.max(5, Number(limit) || 25)) });
    const unread = await session.unseen();
    remember(id, unread);
    return { total: box.exists, unread, messages: page.map(summary) };
  });
}

// One message, read. Marking it seen is the caller's decision and not a side effect of
// looking: the panel opens a message when you click it, and a reader who clicked the
// wrong line has not read it.
export async function readMessage(id, uid, { markSeen = false } = {}) {
  return withInbox(id, async (session) => {
    const got = await session.message(uid);
    const parts = readableBody(got.raw);
    // readableBody walks the tree for the words; the envelope at the top is wanted whole.
    const headers = parseHeaders(splitHeaders(got.raw).head);
    if (markSeen) {
      await session.flag(uid, '\\Seen', true);
      const unread = await session.unseen();
      remember(id, unread);
    }
    const body = parts.text || (parts.html ? htmlToText(parts.html) : '');
    return {
      uid: Number(uid),
      from: ADDR(header(headers, 'from')),
      to: addresses(header(headers, 'to')).slice(0, 12),
      cc: addresses(header(headers, 'cc')).slice(0, 12),
      subject: decodeWords(header(headers, 'subject')) || '(no subject)',
      at: (() => { const t = Date.parse(header(headers, 'date')); return Number.isFinite(t) ? new Date(t).toISOString() : null; })(),
      messageId: header(headers, 'message-id'),
      references: header(headers, 'references'),
      body,
      fromHtml: !parts.text && !!parts.html,
      truncated: got.truncated,
      attachments: parts.attachments,
    };
  });
}

export async function setFlag(id, uid, flag, on) {
  const which = String(flag) === 'flagged' ? '\\Flagged' : '\\Seen';
  return withInbox(id, async (session) => {
    await session.flag(uid, which, !!on);
    const unread = await session.unseen();
    remember(id, unread);
    return { unread };
  });
}

// A reply goes out over SMTP and a copy of it is filed over IMAP. The filing is best
// effort: a server with no Sent folder, or one that refuses the APPEND, has still
// delivered the message, and telling the reader their reply failed would be a lie.
export async function send(id, draft = {}) {
  const account = find(id);
  if (!account) throw new Error('there is no such account');
  const message = {
    from: { name: account.name || '', address: account.address },
    to: addresses(String(draft.to || '')),
    cc: addresses(String(draft.cc || '')),
    subject: String(draft.subject || '').slice(0, 300),
    text: String(draft.body || '').slice(0, 64 * 1024),
    inReplyTo: draft.inReplyTo ? String(draft.inReplyTo).slice(0, 400) : null,
    references: draft.references ? String(draft.references).slice(0, 2000) : null,
  };
  const sent = await sendMail({ ...account.smtp, user: account.user, pass: account.pass, insecure: account.insecure }, message);

  let filed = null;
  try {
    filed = await withInbox(id, async (session) => {
      // Gmail puts a copy in Sent Mail the moment its own SMTP accepts the message, so
      // filing one here as well is how every reply ends up in there twice. It says who it
      // is in its capabilities, which is a better test than reading the hostname.
      if (session.gmail) return 'Sent Mail';
      const folder = await session.sentFolder();
      if (!folder) return null;
      await session.append(folder, sent.raw);
      return folder;
    });
  } catch { /* delivered but not filed, which is not the reader's problem */ }

  return { id: sent.id, to: message.to.map((a) => a.address), filed };
}

// The form's own button: does this actually log in? Run against what was typed rather
// than against what is saved, so a password can be tried before it is kept.
export async function check(spec = {}) {
  const existing = spec.id ? find(spec.id) : null;
  const account = readAccount(spec, existing);
  const session = await openImap({ ...account.imap, user: account.user, pass: account.pass, insecure: account.insecure });
  try {
    const box = await session.select('INBOX');
    const unread = await session.unseen();
    return { ok: true, total: box.exists, unread };
  } finally {
    await session.logout().catch(() => {});
  }
}

// ---- the flag on the box --------------------------------------------------------------
// What the island polls, and the only thing it polls: a number per account, cached, with
// an account that refused us left alone until somebody does something about it.

function remember(id, unread) {
  state.set(id, { unread, at: Date.now(), error: null, sulkUntil: 0 });
}

function blame(id, e) {
  const message = String((e && e.message) || e);
  // A refused login is the one failure that must not be retried on a timer.
  const refused = /refused the login|authenticat|\bLOGIN\b|credential|password/i.test(message);
  state.set(id, {
    unread: (state.get(id) || {}).unread || 0,
    at: Date.now(),
    error: message,
    sulkUntil: refused ? Date.now() + SULK_MS : 0,
  });
}

// Every account's unread count, as fresh as it is worth being. `force` is the reader
// pressing the button, which also wakes an account that was put aside.
export async function unread({ force = false } = {}) {
  const out = [];
  for (const a of load()) {
    const held = state.get(a.id);
    const fresh = held && !held.error && Date.now() - held.at < FRESH_MS;
    const sulking = held && held.sulkUntil > Date.now();
    if (!force && (fresh || sulking)) {
      out.push({ id: a.id, unread: held.unread || 0, error: sulking ? held.error : null, asleep: !!sulking });
      continue;
    }
    try {
      const n = await withInbox(a.id, async (session) => {
        await session.select('INBOX');
        return session.unseen();
      });
      remember(a.id, n);
      out.push({ id: a.id, unread: n, error: null, asleep: false });
    } catch (e) {
      blame(a.id, e);
      const now = state.get(a.id);
      out.push({ id: a.id, unread: now.unread || 0, error: now.error, asleep: now.sulkUntil > Date.now() });
    }
  }
  return out;
}

// What the panel opens on: who is in the box, and how much is waiting in each.
export async function mailView({ force = false } = {}) {
  const accounts = listAccounts();
  if (!accounts.length) return { accounts: [], counts: [] };
  return { accounts, counts: await unread({ force }) };
}
