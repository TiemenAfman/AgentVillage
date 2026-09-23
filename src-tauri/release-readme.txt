Promptholm for Windows
======================

  promptholm-island.exe   the islander: runs the island, with a tray icon to open, stop,
                          restart and quit it. Start this one.
  promptholm.exe          the viewer: the island in a window of its own. Starts the
                          islander too if it is not running yet.
  app\                    the island itself. Leave it next to the two exes.

Unpack this folder wherever you like and start promptholm-island.exe. Its icon appears in
the tray (perhaps behind the ^); a left click opens the viewer. A shortcut to it in
shell:startup starts the island at logon.

What it needs: Node.js 22 or newer (https://nodejs.org, the LTS version), and Claude Code,
whose sessions become the settlers. If Node is missing it says so when you start it.

The first start founds your island: config.json and data\ are made in
%LOCALAPPDATA%\Promptholm, and a session hook is added to %USERPROFILE%\.claude\settings.json
(backed up first; a Promptholm hook that is already there is left alone). Because your
island lives there and not in this folder, you can unpack a newer version over this one,
or move the folder, without losing it.

The exes are not signed, so Windows may say "Windows protected your PC" the first time:
"More info" -> "Run anyway". If the zip was downloaded, unblock it before unpacking
(right click -> Properties -> Unblock, or `Unblock-File` in PowerShell).
