// The postbox on the town hall pavement, opened.
//
// What it shows is somebody's actual inbox, read over IMAP by the server and handed here
// as plain data - see lib/mail.mjs, which is where the password stays. This half never
// has one: an account arrives with `hasPassword` and nothing more, and the field in the
// settings form starts empty and stays empty unless it is being changed.
//
// The one rule worth stating out loud: nothing that came out of a message is ever put
// into the page as HTML. A subject, a sender, a line of the body - all of it is somebody
// else's writing, and all of it goes through esc() or into a textContent. The server
// strips a message down to text before it ever gets here, and this escapes it again on
// the way in. Two locks on one door, the same as the panels on the island have.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// What the island said, or why it could not be read. The same shape as the seed stall's
// answerOf, and for the same reason - a page newer than the server it is talking to gets
// the static file handler's "Not found" instead of JSON, and "Unexpected token 'N'" tells
// the reader nothing at all.
async function answerOf(r) {
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON, which is itself the news */ }
  if (r.ok) return body || {};
  if (body && body.error) throw new Error(body.error);
  if (r.status === 404) throw new Error('this island has no postbox yet: the page is newer than the server serving it. Restart the island.');
  throw new Error(`the island said ${r.status}`);
}

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  const days = Math.floor((today - d) / 86400000);
  if (days < 7) return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

const who = (a) => (a && (a.name || a.address)) || 'somebody';
const size = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);

export function createMailbox(root, { onCounts, onClose } = {}) {
  let view = { accounts: [], counts: [] };
  let pick = null;            // which account is open
  let page = 'inbox';         // inbox | message | write | settings
  let list = null;            // what is in the inbox
  let open = null;            // the message being read
  let draft = null;           // what is being written
  let editing = null;         // which account the settings form is for, or 'new'
  let filling = null;         // and what is in that form right now
  let busy = false;
  let said = '';

  const el = document.createElement('div');
  el.className = 'handover';
  el.hidden = true;
  root.appendChild(el);

  function onKey(e) {
    if (el.hidden) return;
    if (e.key === 'Escape') {
      // Stopped dead rather than merely not bubbled: walk.js listens on this same window
      // and close() has just given its feet back, so it would read this very Escape as
      // "up to the sky". Only stopImmediatePropagation reaches a listener on the same
      // element - the same note as in market.js, for the same reason.
      e.preventDefault();
      e.stopImmediatePropagation();
      // A half-written reply is not thrown away by the key you press to put the pen down.
      if (page === 'write' && draft && (draft.body || '').trim()) { said = 'Press Discard to throw the reply away.'; render(); return; }
      close();
      return;
    }
    e.stopPropagation();
  }
  el.addEventListener('keydown', (e) => e.stopPropagation());
  addEventListener('keydown', onKey);

  async function ask(body) {
    return answerOf(await fetch('/api/mail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
  }

  async function load(force = false) {
    view = await answerOf(await fetch(`/api/mail${force ? '?force=1' : ''}`, { cache: 'no-store' }));
    if (onCounts) onCounts(view.counts || []);
    if (!view.accounts.length) { page = 'settings'; startForm('new'); pick = null; return; }
    if (!pick || !view.accounts.some((a) => a.id === pick)) pick = view.accounts[0].id;
  }

  async function openPanel() {
    el.hidden = false;
    said = '';
    open = null;
    draft = null;
    page = 'inbox';
    el.innerHTML = '<div class="handover-panel wide"><p class="muted">Opening the box…</p></div>';
    try {
      await load();
      if (pick) await loadInbox();
    } catch (e) {
      said = `<span class="bad">${esc(e.message)}</span>`;
    }
    render();
  }

  // Every button goes through here, so "the server said no" is said in one place and the
  // panel is always redrawn from whatever came back.
  async function act(work, note) {
    if (busy) return;
    busy = true;
    said = '';
    render();
    try {
      await work();
      if (note) said = note;
    } catch (e) {
      said = `<span class="bad">${esc(e.message)}</span>`;
    } finally {
      busy = false;
      render();
    }
  }

  async function loadInbox() {
    const r = await ask({ op: 'inbox', id: pick, limit: 30 });
    list = { unread: r.unread, total: r.total, messages: r.messages || [] };
    countNow(pick, r.unread);
  }

  // The count the flag on the box reads. Kept in step here as well as on the server, so
  // the flag drops the moment you read the last unread message rather than at the next
  // poll half a minute later.
  function countNow(id, unread) {
    const counts = (view.counts || []).map((c) => (c.id === id ? { ...c, unread, error: null, asleep: false } : c));
    if (!counts.some((c) => c.id === id)) counts.push({ id, unread, error: null, asleep: false });
    view = { ...view, counts };
    if (onCounts) onCounts(counts);
  }

  const countOf = (id) => (view.counts || []).find((c) => c.id === id) || { unread: 0, error: null };
  const accountOf = (id) => (view.accounts || []).find((a) => a.id === id) || null;

  // ---- drawing it ------------------------------------------------------------------

  function render() {
    const tabs = (view.accounts || []).map((a) => {
      const c = countOf(a.id);
      const badge = c.error ? '<i class="mb-warn">!</i>' : c.unread ? `<i class="mb-new">${c.unread}</i>` : '';
      return `<button type="button" class="mb-tab${a.id === pick && page !== 'settings' ? ' on' : ''}" data-open="${esc(a.id)}">${esc(a.label)}${badge}</button>`;
    }).join('');

    el.innerHTML = `
      <div class="handover-panel wide mailbox">
        <button class="x" id="mb-close">✕</button>
        <h3>The postbox</h3>
        <nav class="mb-tabs">
          ${tabs}
          <button type="button" class="mb-tab quiet${page === 'settings' ? ' on' : ''}" id="mb-settings">Accounts</button>
        </nav>
        ${said ? `<p class="mb-said">${said}</p>` : ''}
        ${busy ? '<p class="muted">…</p>' : ''}
        ${page === 'settings' ? settingsPage()
          : page === 'message' ? messagePage()
            : page === 'write' ? writePage()
              : inboxPage()}
      </div>`;
    wire();
  }

  function inboxPage() {
    const account = accountOf(pick);
    if (!account) return '<p class="muted">Nothing in the box.</p>';
    const c = countOf(pick);
    if (c.error) {
      return `<p class="ho-warn">${esc(account.address)} could not be reached: ${esc(c.error)}</p>
        ${c.asleep ? '<p class="muted">It will not be tried again on its own until the settings are saved, so a wrong password cannot lock the account out.</p>' : ''}
        <div class="mb-row-keys"><button class="btn" data-retry>Try again</button>
        <button class="btn quiet" data-edit="${esc(account.id)}">Settings</button></div>`;
    }
    if (!list) return '<p class="muted">Reaching for the post…</p>';
    if (!list.messages.length) return '<p class="muted">The inbox is empty.</p>';
    return `
      <p class="ho-sum">${list.unread ? `<b>${list.unread}</b> unread` : 'Nothing unread'} ·
        ${list.messages.length} of ${list.total} in the inbox</p>
      <div class="mb-list">${list.messages.map(row).join('')}</div>
      <div class="mb-row-keys">
        <button class="btn" data-refresh>Look again</button>
        <button class="btn primary" data-write>Write one</button>
      </div>`;
  }

  function row(m) {
    return `
      <article class="mb-item${m.seen ? '' : ' unread'}" data-uid="${m.uid}" tabindex="0">
        <span class="mb-dot"></span>
        <div class="mb-what">
          <b>${esc(who(m.from))}</b>
          <p>${esc(m.subject)}</p>
        </div>
        <span class="mb-when">${esc(when(m.at))}${m.answered ? ' ↩' : ''}</span>
      </article>`;
  }

  function messagePage() {
    if (!open) return '<p class="muted">…</p>';
    const to = (open.to || []).map(who).join(', ');
    return `
      <div class="mb-head">
        <b>${esc(open.subject)}</b>
        <small>${esc(who(open.from))}${open.from.address && open.from.name ? ` &lt;${esc(open.from.address)}&gt;` : ''}
          · ${esc(when(open.at))}${to ? ` · to ${esc(to)}` : ''}</small>
      </div>
      ${open.attachments && open.attachments.length
        ? `<p class="mb-clips">${open.attachments.map((a) => `<span class="tag">${esc(a.name)} · ${esc(size(a.bytes))}</span>`).join(' ')}
           <small class="muted">Attachments stay on the server; the box only reads the words.</small></p>` : ''}
      ${open.fromHtml ? '<p class="muted">This one was sent as a web page; what is below is the text taken out of it.</p>' : ''}
      <pre class="mb-body">${esc(open.body || '(nothing but the envelope)')}</pre>
      ${open.truncated ? '<p class="muted">Too long to read whole; this is the start of it.</p>' : ''}
      <div class="mb-row-keys">
        <button class="btn" data-back>Back</button>
        <button class="btn primary" data-reply>Reply</button>
        <button class="btn quiet" data-unread>Mark unread</button>
      </div>`;
  }

  function writePage() {
    const account = accountOf(pick);
    return `
      <div class="mb-write">
        <label>To<input type="text" id="mb-to" value="${esc(draft.to)}" placeholder="somebody@example.com"></label>
        <label>Subject<input type="text" id="mb-subject" value="${esc(draft.subject)}"></label>
        <textarea id="mb-body" rows="10" placeholder="Write it here.">${esc(draft.body)}</textarea>
        <small class="muted">Going out as ${esc(account ? account.address : 'nobody')}${draft.inReplyTo ? ', as a reply' : ''}.</small>
      </div>
      <div class="mb-row-keys">
        <button class="btn primary" data-send>Send</button>
        <button class="btn quiet" data-discard>Discard</button>
      </div>`;
  }

  function settingsPage() {
    const rows = (view.accounts || []).map((a) => {
      const c = countOf(a.id);
      return `
        <article class="mb-account">
          <div class="mb-what">
            <b>${esc(a.label)}</b>
            <small>${esc(a.address)} · ${esc(a.imap.host)}:${a.imap.port}${a.imap.secure ? ' SSL' : ' STARTTLS'}
              ${c.error ? `<span class="bad">· ${esc(c.error)}</span>` : ''}</small>
          </div>
          <div class="mb-row-keys">
            <button class="btn tiny" data-edit="${esc(a.id)}">Settings</button>
            <button class="btn tiny quiet" data-forget="${esc(a.id)}">Take out</button>
          </div>
        </article>`;
    }).join('');

    return `
      <p class="ho-sum">Whose post this box holds. The servers, the usernames and the passwords are kept
        in <code>data/mail.json</code> on this machine, which git has never tracked, and no password is ever
        sent back to this page.</p>
      <div class="mb-accounts">${rows || '<p class="muted">Nobody\'s yet.</p>'}</div>
      ${filling ? form() : '<div class="mb-row-keys"><button class="btn primary" data-edit="new">Add an account</button></div>'}`;
  }

  // What is in the form is held here rather than read off the DOM when the button is
  // pressed, and that is not a preference: pressing Test redraws the panel, and a form
  // rendered from an account would come back with eight fields wiped and the password
  // gone with them. The same rule the reply draft follows a few lines up.
  function startForm(id) {
    const a = id && id !== 'new' ? accountOf(id) : null;
    editing = id;
    filling = {
      id: a ? a.id : null,
      hasPassword: !!(a && a.hasPassword),
      label: a ? a.label : '',
      address: a ? a.address : '',
      name: a ? a.name : '',
      user: a ? a.user : '',
      pass: '',
      imapHost: a ? a.imap.host : '',
      imapPort: a ? a.imap.port : 993,
      imapSecure: a ? a.imap.secure : true,
      smtpHost: a ? a.smtp.host : '',
      smtpPort: a ? a.smtp.port : 587,
      smtpSecure: a ? a.smtp.secure : false,
      insecure: a ? !!a.insecure : false,
    };
  }

  function form() {
    const d = filling;
    return `
      <form class="mb-form" id="mb-form">
        <h4>${d.id ? esc(d.label || d.address) : 'A new account'}</h4>
        <label>Name on the tab<input type="text" name="label" value="${esc(d.label)}" placeholder="Work"></label>
        <label>E-mail address<input type="text" name="address" value="${esc(d.address)}" placeholder="you@example.com"></label>
        <label>Your name, as it goes out<input type="text" name="name" value="${esc(d.name)}" placeholder="Jan Jansen"></label>
        <label>Username<input type="text" name="user" value="${esc(d.user)}" placeholder="the same as the address, usually"></label>
        <label>Password<input type="password" name="pass" value="${esc(d.pass)}" autocomplete="off"
          placeholder="${d.hasPassword ? 'kept — type to change it' : 'the one you sign in with'}"></label>
        <fieldset>
          <legend>Incoming (IMAP)</legend>
          <label>Server<input type="text" name="imapHost" value="${esc(d.imapHost)}" placeholder="mail.example.com"></label>
          <label>Port<input type="number" name="imapPort" value="${d.imapPort}" min="1" max="65535"></label>
          <label class="mb-check"><input type="checkbox" name="imapSecure" ${d.imapSecure ? 'checked' : ''}> SSL (993). Off means STARTTLS on 143.</label>
        </fieldset>
        <fieldset>
          <legend>Outgoing (SMTP)</legend>
          <label>Server<input type="text" name="smtpHost" value="${esc(d.smtpHost)}" placeholder="the same one, usually"></label>
          <label>Port<input type="number" name="smtpPort" value="${d.smtpPort}" min="1" max="65535"></label>
          <label class="mb-check"><input type="checkbox" name="smtpSecure" ${d.smtpSecure ? 'checked' : ''}> SSL (465). Off means STARTTLS on 587.</label>
        </fieldset>
        <label class="mb-check"><input type="checkbox" name="insecure" ${d.insecure ? 'checked' : ''}>
          Take the certificate on trust</label>
        <small class="muted">Only for a server of your own whose certificate has expired or was never signed by
          anyone. It stays encrypted either way — what this gives up is the proof that the server on the other
          end is the one you meant, so it is not a box to tick for somebody else's mail.</small>
        <div class="mb-row-keys">
          <button type="button" class="btn" data-test>Test it</button>
          <button type="submit" class="btn primary">Keep it</button>
          <button type="button" class="btn quiet" data-cancel>Cancel</button>
        </div>
      </form>`;
  }

  // The form, as the server wants it. `pass` is left out entirely when nothing was typed
  // into it, which is what tells lib/mail.mjs to keep the one it already has.
  function formValues() {
    const d = filling;
    const account = {
      label: d.label.trim(), address: d.address.trim(), name: d.name.trim(), user: d.user.trim(),
      imap: { host: d.imapHost.trim(), port: Number(d.imapPort) || 0, secure: !!d.imapSecure },
      smtp: { host: d.smtpHost.trim(), port: Number(d.smtpPort) || 0, secure: !!d.smtpSecure },
      insecure: !!d.insecure,
    };
    if (d.id) account.id = d.id;
    if (d.pass) account.pass = d.pass;
    return account;
  }

  // ---- what the buttons do ----------------------------------------------------------

  function wire() {
    const on = (sel, ev, fn) => el.querySelectorAll(sel).forEach((n) => n.addEventListener(ev, fn));
    el.querySelector('#mb-close').addEventListener('click', close);
    el.querySelector('#mb-settings').addEventListener('click', () => { page = 'settings'; closeForm(); said = ''; render(); });

    on('[data-open]', 'click', (e) => {
      pick = e.currentTarget.dataset.open;
      page = 'inbox';
      list = null;
      act(() => loadInbox());
    });

    on('[data-refresh]', 'click', () => act(async () => { await load(true); await loadInbox(); }));
    on('[data-retry]', 'click', () => act(async () => { await load(true); await loadInbox(); }));

    on('.mb-item', 'click', (e) => openMessage(Number(e.currentTarget.dataset.uid)));
    on('.mb-item', 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMessage(Number(e.currentTarget.dataset.uid)); } });

    on('[data-back]', 'click', () => { page = 'inbox'; open = null; render(); });
    on('[data-reply]', 'click', () => startReply());
    on('[data-write]', 'click', () => startWrite());
    on('[data-unread]', 'click', () => act(async () => {
      const r = await ask({ op: 'flag', id: pick, uid: open.uid, flag: 'seen', on: false });
      countNow(pick, r.unread);
      page = 'inbox';
      open = null;
      await loadInbox();
    }));

    const body = el.querySelector('#mb-body');
    if (body) {
      // The draft is held in JS rather than read off the DOM at the end, so a redraw -
      // an error, a count coming back - cannot take somebody's half-written reply with it.
      const keep = () => {
        draft.to = el.querySelector('#mb-to').value;
        draft.subject = el.querySelector('#mb-subject').value;
        draft.body = body.value;
      };
      for (const id of ['#mb-to', '#mb-subject', '#mb-body']) el.querySelector(id).addEventListener('input', keep);
      body.focus();
    }
    on('[data-send]', 'click', () => act(async () => {
      const sent = await ask({ op: 'send', id: pick, draft });
      draft = null;
      page = 'inbox';
      await loadInbox();
      said = `Sent to ${esc(sent.sent.to.join(', '))}${sent.sent.filed ? '' : ' (there was nowhere to file a copy)'}.`;
    }));
    on('[data-discard]', 'click', () => { draft = null; page = open ? 'message' : 'inbox'; said = ''; render(); });

    on('[data-edit]', 'click', (e) => { page = 'settings'; startForm(e.currentTarget.dataset.edit); said = ''; render(); });
    on('[data-cancel]', 'click', () => { closeForm(); said = ''; render(); });
    on('[data-forget]', 'click', (e) => {
      const id = e.currentTarget.dataset.forget;
      const a = accountOf(id);
      if (!confirm(`Take ${a ? a.address : 'this account'} out of the box? The mail itself is untouched.`)) return;
      act(async () => {
        view = await ask({ op: 'remove', id });
        if (onCounts) onCounts(view.counts || []);
        if (pick === id) pick = view.accounts.length ? view.accounts[0].id : null;
        closeForm();
      }, 'Taken out.');
    });
    on('[data-test]', 'click', () => act(async () => {
      const r = await ask({ op: 'check', account: formValues() });
      said = `<b>That works.</b> ${r.total} in the inbox, ${r.unread} unread.`;
    }));

    const f = el.querySelector('#mb-form');
    if (f) {
      // Every keystroke goes straight into `filling`, so a redraw between typing and
      // pressing Keep it cannot lose a field.
      const keep = (e) => {
        const t = e.target;
        if (!t.name || !(t.name in filling)) return;
        filling[t.name] = t.type === 'checkbox' ? t.checked : t.value;
      };
      f.addEventListener('input', keep);
      f.addEventListener('change', keep);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const account = formValues();
        act(async () => {
          const r = await ask({ op: 'save', account });
          view = { accounts: r.accounts || [], counts: r.counts || [] };
          if (onCounts) onCounts(view.counts);
          pick = r.account.id;
          closeForm();
          page = 'inbox';
          await loadInbox();
        }, 'Kept.');
      });
    }
  }

  // Back to the list of accounts - or straight back into an empty form, because a box
  // with nobody's post in it has nothing else to show.
  function closeForm() {
    if (view.accounts.length) { editing = null; filling = null; return; }
    startForm('new');
  }

  function openMessage(uid) {
    act(async () => {
      const r = await ask({ op: 'read', id: pick, uid, markSeen: true });
      open = r.message;
      page = 'message';
      // The row we just read is now read, and so is the count on the tab: both are set
      // here rather than waited for, so the flag on the box outside drops at the same
      // moment the dot on the line does.
      if (list) {
        const was = list.messages.find((m) => m.uid === uid);
        if (was && !was.seen) { was.seen = true; list.unread = Math.max(0, list.unread - 1); countNow(pick, list.unread); }
      }
    });
  }

  function startWrite() {
    draft = { to: '', subject: '', body: '', inReplyTo: null, references: null };
    page = 'write';
    said = '';
    render();
  }

  // A reply quotes what it is answering, which is the only place this panel puts one
  // person's words into another's - and it goes into a textarea's value, never into HTML.
  function startReply() {
    const quoted = String(open.body || '').split('\n').slice(0, 200).map((l) => `> ${l}`).join('\n');
    draft = {
      to: open.from.address || '',
      subject: /^re:/i.test(open.subject) ? open.subject : `Re: ${open.subject}`,
      body: `\n\nOn ${when(open.at)}, ${who(open.from)} wrote:\n${quoted}\n`,
      inReplyTo: open.messageId || null,
      references: [open.references, open.messageId].filter(Boolean).join(' ').trim() || null,
    };
    page = 'write';
    said = '';
    render();
  }

  function close() {
    el.hidden = true;
    el.innerHTML = '';
    open = null;
    draft = null;
    // Whatever was typed into the settings form goes with it, password and all: the panel
    // holds one only while it is open, and only because a redraw would otherwise lose it.
    editing = null;
    filling = null;
    if (onClose) onClose();
  }

  return {
    open: openPanel,
    close,
    isOpen: () => !el.hidden,
    dispose: () => { removeEventListener('keydown', onKey); el.remove(); },
  };
}
