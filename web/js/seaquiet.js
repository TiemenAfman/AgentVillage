// What to say when the sea stops answering.
//
// The sea walks every crowd, this island's own included (CLAUDE.md: there is no local
// simulation left in the browser), so a sea that does not answer is an island standing
// empty - and on 26 September it stood empty for twelve minutes with nothing on the screen
// or in the log to say why, until the keeper asked. net.js says 'quiet' once the socket has
// failed to open for QUIET_MS; this is the sentence that goes up, and it comes down again
// the moment a socket opens.
//
// Kept DOM-free, like web/js/update.js, so tests/sea-quiet.test.mjs can hold it without a
// browser.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// `url` is the sea being knocked on (hello.sea), `mode` the islander's multiplayer.sea.mode
// and `open` whether that sea is the open one (both from /api/hello, absent from an older
// islander), `keeper` whether this page belongs to the island's own keeper.
//
// Named the way the keeper chose it: "the online sea" is the main menu's own card for the
// open sea; a sea of our own (single or host) runs inside the islander's process, so it
// has no address worth reading out - "localhost:4750" says nothing to anybody.
export function seaQuietNotice({ url = null, mode = null, open = false, keeper = false } = {}) {
  let who;
  if (mode === 'single' || mode === 'host') who = 'This island’s own sea';
  else if (open) who = 'The online sea';
  else {
    let host = null;
    try { host = url ? new URL(url).host : null; } catch { /* not an address; said without one */ }
    who = host ? `The sea at ${esc(host)}` : 'The sea';
  }
  // Only somebody else's sea can be left for one of our own, and only by the keeper - it
  // is the islander's config, and a visitor's page has no say in it. Settings, not the
  // main menu: the menu opens with the page, Settings is there for the whole visit, and
  // both call the choice "On my own".
  const hint = keeper && mode === 'join'
    ? ' <b>On my own</b> under Settings → The sea keeps the island alive without it.'
    : '';
  return `<b>${who} is not answering</b>, so nobody is walking on the island. Still trying.${hint}`;
}
