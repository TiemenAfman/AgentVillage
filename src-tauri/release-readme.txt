Promptholm for Windows - the islander and the viewer
====================================================

  promptholm-island.exe   the islander: runs the island's server (serve.mjs) with a tray icon
                          to open, stop, restart and quit it
  agentvillage.exe        the viewer: the island in a window of its own; starts the islander
                          if nothing is running

These are not the whole island. They run the checkout they are unpacked into, so you need:

  1. Node 22 or newer, and a checkout of https://github.com/TiemenAfman/AgentVillage
     with `npm install` and `npm run setup` done in it (see its README).
  2. This zip unpacked into <checkout>\bin\  - the exes find the checkout by walking up
     from their own folder. bin\ is gitignored, so git pull leaves it alone.

Then start bin\promptholm-island.exe. Its icon appears in the tray (perhaps behind the ^);
a left click opens the viewer. A shortcut to it in shell:startup starts the island at logon.

The exes are not signed, so Windows may say "Windows protected your PC" the first time:
"More info" -> "Run anyway". If the zip was downloaded, unblock it before unpacking
(right click -> Properties -> Unblock, or `Unblock-File` in PowerShell).

Keep the exes and the checkout on the same release: after a git pull that changes
src-tauri\, download the matching release (or build them yourself with Rust:
`npm run app:build`).
