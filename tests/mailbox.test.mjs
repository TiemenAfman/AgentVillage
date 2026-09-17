// The postbox on the town hall pavement, and the mail machinery behind it.
//
// Three things are worth a net here and they are worth it for different reasons.
//
// The box itself is a mesh like every other civic, and the mesh tests on this island all
// ask the same two questions: is it one draw call, and does it fit on the cell it was
// given. The flag is the part that moves, and the thing that would break silently is the
// flag being built but never publishing its anchor - the clock tower stood on the square
// with a blank dial for months for exactly that reason (see web/js/clock.js).
//
// The parsing is where a net earns most. lib/mime.mjs reads what a stranger wrote, and
// the encodings it has to undo are the sort of thing that works on your own inbox and
// falls over on the first message from somebody whose mail client is older than yours.
// Every case below is a real shape: a subject split across two encoded words, an accented
// letter in windows-1252, a message that sent its text twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import {
  decodeWords, decodeQuoted, readableBody, htmlToText, addresses, parseHeaders, encodeHeader, mailDate,
} from '../lib/mime.mjs';
import { buildMessage } from '../lib/smtp.mjs';
import { readAccount, publicAccount } from '../lib/mail.mjs';

register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding } = await import('../web/js/buildings.js');
const { buildMailFlagGeometry, attachMailFlag, setMailFlag, updateMailFlag } = await import('../web/js/mailflag.js');
delete globalThis.document;

// ---- the box ------------------------------------------------------------------------

test('the postbox is one mesh, stands on its cell, and publishes its flag', () => {
  const b = buildBuilding({ id: 'civic:mailbox', kind: 'civic', civicType: 'mailbox', style: 'unknown' });
  assert.equal(b.geometry.groups.length, 0, 'a building is one draw call');
  // A cell is 1.0 across and the box shares its paving with whoever is walking past it.
  assert.ok(b.bbox.max.x < 0.5 && b.bbox.min.x > -0.5, 'the postbox is wider than the cell it stands on');
  assert.ok(b.bbox.max.z < 0.5 && b.bbox.min.z > -0.5);
  assert.ok(b.bbox.max.y <= b.height + 1e-5, 'something reaches above the height it declares');
  assert.ok(b.height > 0.9 && b.height < 1.3, 'a postbox is chest high');
  // No porch: it is street furniture set in a pad of its own, and a step round it would
  // be a plinth under a letter box.
  assert.ok(b.bbox.min.y > -0.2, 'the postbox has been given a porch');
  assert.ok(b.animated && b.animated.mailflag, 'nothing would ever raise the flag');
  const [fx, fy] = b.animated.mailflag.at;
  assert.ok(fx > 0.1, 'the flag is on the cheek of the box, not inside it');
  assert.ok(fy > 0.5 && fy < b.height, 'the flag is hung somewhere off the box');
});

test('the flag goes up when there is post and stays where it is put', () => {
  const g = buildMailFlagGeometry();
  assert.ok(g.attributes.position.count > 0);
  const group = { add() { this.held = true; } };
  const flag = attachMailFlag(group, [0.185, 0.7, 0], null);
  assert.ok(group.held, 'the flag was never hung on the building');
  const down = flag.angle;
  assert.ok(down < -1, 'a flag at rest lies back along the box');

  // Nothing moves until it is told, and then it takes more than one frame to get there:
  // the whole point of the flag is that you can catch it going up as you walk past.
  updateMailFlag(flag, 0.016);
  assert.equal(flag.angle, down);
  setMailFlag(flag, true);
  updateMailFlag(flag, 0.016);
  assert.ok(flag.angle > down && flag.angle < 0, 'the flag teleported instead of swinging');
  for (let i = 0; i < 200; i++) updateMailFlag(flag, 0.016);
  assert.equal(flag.angle, 0, 'the flag never finished going up');
  assert.equal(flag.mesh.rotation.z, 0);

  setMailFlag(flag, false);
  for (let i = 0; i < 200; i++) updateMailFlag(flag, 0.016);
  assert.equal(flag.angle, down, 'the flag never came back down');
});

// ---- what a stranger wrote ------------------------------------------------------------

test('a header says what it meant, whatever it was encoded as', () => {
  assert.equal(decodeWords('=?utf-8?B?SGVsbG8=?= =?utf-8?Q?_w=C3=A9reld?='), 'Hello wéreld',
    'two adjacent encoded words are joined without the fold between them');
  assert.equal(decodeWords('Re: =?ISO-8859-1?Q?caf=E9?= tomorrow'), 'Re: café tomorrow',
    'an encoded word in the middle of a plain subject');
  assert.equal(decodeWords('nothing to undo'), 'nothing to undo');
  assert.equal(decodeWords('=?x-made-up?B?aGk=?='), 'hi', 'an unknown charset is not an error');
  // =3D is a byte and not a character: undoing it before the charset is known is what
  // turns every accented letter in a windows-1252 message into a question mark.
  assert.equal(decodeQuoted('caf=E9').toString('latin1'), 'café');
  assert.equal(decodeQuoted('one=\r\ntwo').toString('latin1'), 'onetwo', 'a soft line break');
});

test('an address list survives a comma in somebody\'s name', () => {
  const list = addresses('"Jansen, Jan" <jan@example.nl>, piet@example.nl, =?utf-8?B?UsOpbmU=?= <rene@example.nl>');
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { name: 'Jansen, Jan', address: 'jan@example.nl' });
  assert.deepEqual(list[1], { name: '', address: 'piet@example.nl' });
  assert.equal(list[2].name, 'Réne');
});

test('folded headers come back as one line', () => {
  const h = parseHeaders('Subject: a long one\r\n  carried on\r\nFrom: jan@example.nl');
  assert.equal(h.get('subject')[0], 'a long one carried on');
  assert.equal(h.get('from')[0], 'jan@example.nl');
});

test('a message sent twice is read once, and the plain copy wins', () => {
  const raw = Buffer.from([
    'Subject: hoi',
    'Content-Type: multipart/mixed; boundary="outer"',
    '',
    '--outer',
    'Content-Type: multipart/alternative; boundary="inner"',
    '',
    '--inner',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'hallo caf=C3=A9',
    '--inner',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>hallo</p>',
    '--inner--',
    '--outer',
    'Content-Type: application/pdf; name="offerte.pdf"',
    'Content-Disposition: attachment; filename="offerte.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('not really a pdf').toString('base64'),
    '--outer--',
    '',
  ].join('\r\n'), 'utf8');

  const read = readableBody(raw);
  assert.equal(read.text, 'hallo café');
  assert.ok(read.html.includes('hallo'), 'the rich copy is kept as a fallback');
  assert.equal(read.attachments.length, 1);
  assert.equal(read.attachments[0].name, 'offerte.pdf');
  assert.equal(read.attachments[0].bytes, 16);
});

test('a message with nothing but HTML in it is still readable', () => {
  const raw = Buffer.from('Content-Type: text/html\r\n\r\n<p>one</p><script>alert(1)</script><p>two &amp; three</p>', 'utf8');
  const read = readableBody(raw);
  assert.equal(read.text, '');
  assert.equal(htmlToText(read.html), 'one\ntwo & three', 'the script goes and the entities come back');
});

// ---- what goes out --------------------------------------------------------------------

test('a reply is a message a mail server will take', () => {
  const m = buildMessage({
    from: { name: 'Jan Jansen', address: 'jan@example.nl' },
    to: [{ name: '', address: 'piet@example.nl' }],
    subject: 'Re: café',
    text: 'Regel een\n.een punt op een regel\nRegel twee',
    inReplyTo: '<abc@example.nl>',
  });
  const [head] = m.raw.split('\r\n\r\n');
  assert.ok(head.includes('From: "Jan Jansen" <jan@example.nl>'));
  assert.ok(head.includes('To: <piet@example.nl>'));
  assert.ok(head.includes('In-Reply-To: <abc@example.nl>'));
  assert.ok(head.includes('Subject: =?UTF-8?B?'), 'a subject with an accent in it goes out encoded');
  assert.ok(/^Date: \w{3}, \d{1,2} \w{3} \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/m.test(head), 'RFC 5322 spells the date its own way');
  assert.deepEqual(m.recipients, ['piet@example.nl']);
  // Base64 out, so that nothing between here and the other end can decide it knows better
  // about a long line, a leading dot or a trailing space.
  const body = m.raw.split('\r\n\r\n')[1];
  assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'),
    'Regel een\r\n.een punt op een regel\r\nRegel twee');
  assert.ok(!/\n(?!\r)/.test(m.raw.replace(/\r\n/g, '')), 'every line ending is a CRLF');
});

test('a message with nowhere to go is refused before the socket is opened', () => {
  const from = { name: '', address: 'jan@example.nl' };
  assert.throws(() => buildMessage({ from, to: [], subject: '', text: '' }), /who it is going to/);
  assert.throws(() => buildMessage({ from, to: [{ address: 'not an address' }] }), /is not an address/);
});

test('an encoded header is cut on a character and never through one', () => {
  const long = 'é'.repeat(60);
  const out = encodeHeader(long);
  const decoded = decodeWords(out.replace(/\r\n /g, ' '));
  assert.equal(decoded, long, 'a multi-byte character was cut in half between two words');
  assert.equal(encodeHeader('plain ascii'), 'plain ascii', 'ASCII is left alone');
  assert.ok(mailDate(new Date()).length > 20);
});

// ---- the accounts ---------------------------------------------------------------------

test('an account is refused before it can fail on the wire', () => {
  assert.throws(() => readAccount({ address: 'nonsense' }), /not an e-mail address/);
  assert.throws(() => readAccount({ address: 'a@b.nl' }), /which server/);
  assert.throws(() => readAccount({ address: 'a@b.nl', imap: { host: 'mail.b.nl' } }), /password/);
});

test('an account keeps its password, and never hands it out', () => {
  const made = readAccount({
    address: 'a@b.nl', pass: 'hunter2', imap: { host: 'mail.b.nl' },
  });
  assert.equal(made.user, 'a@b.nl', 'the username defaults to the address');
  assert.equal(made.imap.port, 993, 'SSL by default, on the port SSL uses');
  assert.equal(made.smtp.host, 'mail.b.nl', 'and outgoing goes the same way unless told otherwise');
  assert.equal(made.smtp.port, 587);

  // A form that came back without a password is a form somebody did not retype it into.
  const again = readAccount({ address: 'a@b.nl', imap: { host: 'mail.b.nl' } }, made);
  assert.equal(again.pass, 'hunter2');
  assert.equal(again.id, made.id);

  const shown = publicAccount(made);
  assert.equal(shown.hasPassword, true);
  assert.ok(!('pass' in shown), 'the password went out over the wire');
  assert.ok(!JSON.stringify(shown).includes('hunter2'));
});
