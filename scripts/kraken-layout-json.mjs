// The Salty Kraken's layout (web/js/kraken-layout.js) and its dressing (web/js/kraken-dressing.js,
// where every crate, barrel and hoard stands) as one JSON object on stdout, for the Blender side
// (scripts/build-piratetavern-room.py, scripts/preview-krakenroom.py), which cannot import a JS
// module but can run node. The dressing is under the key DRESSING.
import fs from 'node:fs';
import * as L from '../web/js/kraken-layout.js';

const out = { ...L };
if (fs.existsSync(new URL('../web/js/kraken-dressing.js', import.meta.url))) {
  const D = await import('../web/js/kraken-dressing.js');
  out.DRESSING = { ...D };
}
process.stdout.write(JSON.stringify(out));
