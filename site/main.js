// Promptholm.com: three small things, and the page reads fine with none of them running.

// 1. The latest release. The download links already point at /releases/latest/download/,
//    which GitHub always resolves to the newest assets; this only fills in the version, the
//    date and the sizes, and takes the exact asset URLs when the API answers.
(function release() {
  const api = 'https://api.github.com/repos/TiemenAfman/AgentVillage/releases/latest';
  fetch(api, { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((rel) => {
      if (!rel || !rel.tag_name) return;
      for (const el of document.querySelectorAll('[data-release="version"]')) el.textContent = rel.tag_name;
      if (rel.published_at) {
        const when = new Date(rel.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        for (const el of document.querySelectorAll('[data-release="date"]')) el.textContent = `released ${when}`;
      }
      const byName = new Map((rel.assets || []).map((a) => [a.name, a]));
      for (const el of document.querySelectorAll('[data-size]')) {
        const a = byName.get(el.dataset.size);
        if (a && a.size) el.textContent = `${Math.round(a.size / 1e6)} MB`;
      }
      for (const el of document.querySelectorAll('[data-asset]')) {
        const a = byName.get(el.dataset.asset);
        if (a && a.browser_download_url) el.href = a.browser_download_url;
      }
    })
    .catch(() => { /* offline or rate-limited: the static links still work */ });
})();

// 2. Day and night: one camera, two hours, a line between them.
(function daynight() {
  const fig = document.getElementById('daynight');
  const range = document.getElementById('dn-range');
  if (!fig || !range) return;
  const set = (pct) => {
    const v = Math.max(0, Math.min(100, pct));
    fig.style.setProperty('--cut', `${v}%`);
    range.value = String(Math.round(v));
  };
  range.addEventListener('input', () => set(Number(range.value)));
  let dragging = false;
  const fromEvent = (e) => {
    const box = fig.getBoundingClientRect();
    set(((e.clientX - box.left) / box.width) * 100);
  };
  // An <img> under the pointer starts the browser's own image drag, which cancels the pointer
  // after its first move; so no native drag here, and no text selection either.
  fig.addEventListener('dragstart', (e) => e.preventDefault());
  fig.addEventListener('pointerdown', (e) => {
    if (e.target === range) return;
    e.preventDefault();
    dragging = true;
    fig.setPointerCapture(e.pointerId);
    fromEvent(e);
  });
  fig.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
  const stop = () => { dragging = false; };
  fig.addEventListener('pointerup', stop);
  fig.addEventListener('pointercancel', stop);
})();

// 3. The gallery opens large in a dialog.
(function lightbox() {
  const box = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  if (!box || !img || typeof box.showModal !== 'function') return;
  for (const btn of document.querySelectorAll('.gallery button[data-full]')) {
    btn.addEventListener('click', () => {
      const thumb = btn.querySelector('img');
      img.src = btn.dataset.full;
      img.alt = thumb ? thumb.alt : '';
      box.showModal();
    });
  }
  box.addEventListener('click', (e) => { if (e.target === box) box.close(); });
  box.addEventListener('close', () => { img.removeAttribute('src'); });
})();
