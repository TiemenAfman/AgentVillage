// A thought, had wherever you happen to be standing.
//
// Press T on foot and this opens. What you type goes to a Claude session started in the
// island's own repository, and it is told where you are standing - so "what is that
// building over there" and "put a bridge across this stream" are both answerable, and
// the second one changes the ground under your feet.
//
// The conversation keeps its session between thoughts, the way talking to a settler
// does, so you can say "make it wider" and be understood.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SESSION_KEY = 'promptholm.think.session';

// The same small, safe formatting the chat panel uses: fenced code, inline code, bold.
function render(text) {
  return String(text).split(/```/).map((chunk, i) => {
    if (i % 2 === 1) {
      const nl = chunk.indexOf('\n');
      return `<pre><code>${esc((nl >= 0 ? chunk.slice(nl + 1) : chunk).replace(/\n$/, ''))}</code></pre>`;
    }
    return esc(chunk)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .split(/\n{2,}/).filter(Boolean).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  }).join('');
}

export function createThink(root, { onClose, getWhere, onBuilt }) {
  let busy = false;
  let controller = null;
  let where = null;
  let sessionId = null;
  let messages = [];
  try { sessionId = localStorage.getItem(SESSION_KEY) || null; } catch { /* private window */ }

  const el = document.createElement('div');
  el.className = 'think-panel card';
  el.hidden = true;
  el.innerHTML = `
    <header class="think-head">
      <div>
        <h2>A thought</h2>
        <p class="muted" id="think-where"></p>
      </div>
      <div class="think-head-right">
        <button class="btn tiny" id="think-fresh" title="Forget what was said before and start again">Start again</button>
        <button class="x" id="think-close" title="Close · Esc">✕</button>
      </div>
    </header>
    <div class="think-log" id="think-log"></div>
    <form class="think-compose" id="think-form">
      <textarea id="think-input" rows="1" placeholder="Ask, or ask for something here…" spellcheck="false"></textarea>
      <button class="btn primary" id="think-send" type="submit">Think</button>
      <button class="btn" id="think-stop" type="button" hidden>Stop</button>
    </form>
    <p class="think-foot" id="think-foot"></p>`;
  root.appendChild(el);

  const $ = (id) => el.querySelector(`#${id}`);
  const logEl = $('think-log');
  const input = $('think-input');
  const form = $('think-form');

  $('think-close').addEventListener('click', () => close());
  $('think-stop').addEventListener('click', () => { if (controller) controller.abort(); });
  $('think-fresh').addEventListener('click', () => {
    sessionId = null;
    try { localStorage.removeItem(SESSION_KEY); } catch { /* fine */ }
    messages = [];
    draw({ note: 'A clean slate. Nothing said before this.' });
    input.focus();
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(150, input.scrollHeight)}px`;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    e.stopPropagation();                    // walking must not steal the typing
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });

  function onKey(e) {
    if (el.hidden) return;
    if (e.key === 'Escape' && document.activeElement !== input) {
      // Stopped dead, not just from bubbling on: walk.js listens on this same window,
      // and close() has just let its feet go - so it would read this very Escape as
      // "back to the sky". stopPropagation cannot help with a listener on the same
      // element; only stopImmediatePropagation can.
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  }
  addEventListener('keydown', onKey);

  function bubble(m) {
    if (m.role === 'note') return `<div class="think-note">${esc(m.text)}</div>`;
    const tools = (m.tools || []).slice(-8);
    return `<article class="think-msg ${m.role}">
        <div class="who">${m.role === 'user' ? 'You' : 'The island'}</div>
        ${m.text ? `<div class="body">${render(m.text)}</div>` : ''}
        ${tools.length ? `<div class="think-tools">${tools.map((t) => `<span class="tool"><b>${esc(t.name)}</b>${t.hint ? ` ${esc(t.hint)}` : ''}</span>`).join('')}</div>` : ''}
      </article>`;
  }

  function draw({ note } = {}) {
    logEl.innerHTML = messages.map(bubble).join('') + (note ? `<div class="think-note">${esc(note)}</div>` : '');
    logEl.scrollTop = logEl.scrollHeight;
  }

  function describeWhere(w) {
    if (!w) return 'somewhere on the island';
    const at = `x ${w.x.toFixed(1)}, z ${w.z.toFixed(1)}`;
    return w.near ? `${at} · beside ${w.near}` : at;
  }

  async function open() {
    where = getWhere ? getWhere() : null;
    el.hidden = false;
    $('think-where').textContent = `Standing at ${describeWhere(where)}`;
    $('think-foot').textContent = 'Whatever is built lands where you are standing.';
    input.focus();

    // A thought carries on from the last one, and the last one may have been before a
    // reload. Read it back out of the session rather than starting over.
    if (sessionId && !messages.length) {
      draw({ note: 'Remembering the last thought…' });
      try {
        const r = await fetch(`/api/transcript?session=${encodeURIComponent(sessionId)}&limit=40`, { cache: 'no-store' });
        const body = await r.json();
        if (body.ok && body.messages && body.messages.length) {
          // Only what was said, not the long briefing every thought opens with.
          messages = body.messages.map((m) => (m.role === 'user' ? { ...m, text: strip(m.text) } : m));
          draw();
          return;
        }
      } catch { /* it was only a nicety */ }
      sessionId = null;
      try { localStorage.removeItem(SESSION_KEY); } catch { /* fine */ }
    }
    draw({ note: messages.length ? null : 'You are standing still, thinking. Ask about this place, or ask for something to be built here.' });
  }

  // The prompt sent to a thought wraps the question in a briefing. When it is read back
  // out of the transcript, only the question is worth showing.
  function strip(text) {
    const s = String(text || '');
    const start = s.indexOf('They said:\n\n');
    if (start < 0) return s;
    const rest = s.slice(start + 'They said:\n\n'.length);
    const end = rest.indexOf('\n\n---');
    return (end < 0 ? rest : rest.slice(0, end)).trim();
  }

  async function ask(text) {
    const t = String(text || '').trim();
    if (!t || busy) return;
    input.value = '';
    input.style.height = 'auto';
    where = getWhere ? getWhere() : where;
    $('think-where').textContent = `Standing at ${describeWhere(where)}`;

    messages.push({ role: 'user', text: t });
    const pending = { role: 'assistant', text: '', tools: [] };
    messages.push(pending);
    draw({ note: 'Thinking…' });
    setBusy(true);

    controller = new AbortController();
    let built = false;
    try {
      const res = await fetch('/api/think', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t, sessionId, at: where }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `the island said ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let carry = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        carry += dec.decode(value, { stream: true });
        const lines = carry.split('\n');
        carry = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }
          if (handleEvent(ev, pending)) built = true;
          draw({ note: busy ? 'Working…' : null });
        }
      }
      if (!pending.text && !pending.tools.length) pending.text = '(nothing came of it)';
    } catch (e) {
      if (e.name === 'AbortError') pending.text += (pending.text ? '\n\n' : '') + '(you let the thought go)';
      else messages.push({ role: 'note', text: `That did not work: ${e.message}` });
    } finally {
      setBusy(false);
      controller = null;
      draw();
      input.focus();
      if (built && onBuilt) onBuilt();
    }
  }

  // One line of the stream. Returns true when something was put on the island.
  function handleEvent(ev, pending) {
    let touched = false;
    if (ev.type === 'settlers_thought' && ev.sessionId) {
      sessionId = ev.sessionId;
      try { localStorage.setItem(SESSION_KEY, sessionId); } catch { /* private window */ }
      return false;
    }
    if (ev.type === 'assistant' && ev.message) {
      for (const b of ev.message.content || []) {
        if (b.type === 'text' && b.text) pending.text += (pending.text ? '\n' : '') + b.text;
        else if (b.type === 'tool_use') {
          const hint = hintOf(b);
          pending.tools.push({ name: b.name, hint });
          if (/island\.mjs\s+build/.test(hint)) touched = true;
        }
      }
      return touched;
    }
    if (ev.type === 'settlers_error') { messages.push({ role: 'note', text: ev.error }); return false; }
    if (ev.type === 'result' && ev.is_error) { messages.push({ role: 'note', text: ev.result || 'the thought went wrong' }); return false; }
    return false;
  }

  function hintOf(b) {
    const i = b.input || {};
    return String(i.command || i.file_path || i.path || i.pattern || i.description || '').replace(/\s+/g, ' ').slice(0, 110);
  }

  function setBusy(v) {
    busy = v;
    $('think-send').hidden = v;
    $('think-stop').hidden = !v;
    el.classList.toggle('busy', v);
  }

  function close() {
    if (controller) controller.abort();
    el.hidden = true;
    onClose && onClose();
  }

  return {
    open, close,
    isOpen: () => !el.hidden,
    isBusy: () => busy,
    dispose: () => { removeEventListener('keydown', onKey); el.remove(); },
  };
}
