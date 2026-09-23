// Start an open sea.
//
//   node sea.mjs                  on loopback, port 4750
//   node sea.mjs --open           bound to every interface, so the LAN can join
//   node sea.mjs --port 4750 --name "De Waddenzee"
//
// This is the thin end. Everything is in lib/sea.mjs, which is a module rather than an
// entry point on purpose: serve.mjs starts one in its own process for single player and
// for hosting, so that the three ways in - alone, hosting, joining - are one code path
// with a different address rather than three modes to keep in step.
import { createSea } from './lib/sea.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const port = Number(value('port', process.env.SEA_PORT || 4750));
const open = flag('open');
const name = value('name', process.env.SEA_NAME || 'an open sea');
const key = value('key', process.env.SEA_KEY || null);
// The restart button's key, for a sea anybody may join (no SEA_KEY) - see lib/sea.mjs.
const adminKey = value('admin-key', process.env.SEA_ADMIN_KEY || null);
// Where to ask for a redeploy, for the button on the harbour page. Whoever has this can
// replace the container, so it stays in the environment and is never sent to a browser.
const updateHook = value('update-hook', process.env.SEA_UPDATE_HOOK || null);
// Whose afternoon the world is having, by name (Europe/Amsterdam). Without it the machine's
// own zone, which in a container is UTC - see lib/seaclock.mjs.
const zone = value('tz', process.env.SEA_TZ || null);

const stamp = () => new Date().toISOString();
const log = (m) => console.log(`${stamp()} ${m}`);

const sea = createSea({
  port,
  host: open ? '0.0.0.0' : '127.0.0.1',
  name,
  key,
  adminKey,
  updateHook,
  zone,
  // build is left to lib/sea.mjs's default: lib/build.mjs, stamped by Dockerfile.sea.
  log,
});

await sea.listen();
console.log(`[sea] "${name}" is at http://${open ? '0.0.0.0' : 'localhost'}:${port}/`);
console.log(`      its clock reads in ${sea.clock.zone()}.`);
console.log(open
  ? '      open to the network. It holds no files and writes nothing to disk.'
  : '      loopback only. Pass --open to let the rest of the network in.');
if (open && !key) console.log('      no key set: anyone on this network can park an island here.');

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log('\n[sea] closing. The world goes with it, which is the arrangement.');
    await sea.close();
    process.exit(0);
  });
}
