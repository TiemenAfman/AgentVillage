// What code this sea is running: the version and the commit it was built from.
//
// A module and not a file read at start-up, because the sea may not touch node:fs
// (tests/sea-join.test.mjs holds it to http, crypto and os - it writes nothing and reads
// nothing). So the answer is baked in instead: Dockerfile.sea's first stage runs
// scripts/stamp-build.mjs against the checkout Portainer cloned and puts the result here in
// the image, over this file. In a checkout it stays null, and an islander hands its own
// sea the real thing from lib/buildinfo.mjs, which is allowed to look at the disk.
export default { version: null, commit: null };
