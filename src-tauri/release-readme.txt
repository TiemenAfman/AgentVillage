Promptholm for Windows
======================

  promptholm.exe          Start this one: the island in a window of its own. It starts
                          the island too when it is not running yet.
  app\                    the island itself. Leave it next to promptholm.exe.
  app\promptholm-island.exe
                          the islander: runs the island, with a tray icon to open, stop,
                          restart and quit it. Closing the window leaves it running.

Unpack this folder wherever you like and start promptholm.exe. The islander's icon appears
in the tray (perhaps behind the ^); a left click there opens the window again. To start the
island at logon without a window, put a shortcut to app\promptholm-island.exe in
shell:startup. Unpacked over an older version, which had promptholm-island.exe next to
promptholm.exe, that old one is left behind: delete it, the one in app\ is the new one.

What it needs: Node.js 22 or newer (https://nodejs.org, the LTS version), and Claude Code,
whose sessions become the settlers. If Node is missing it says so when you start it.

The first start founds your island: config.json and data\ are made in
%USERPROFILE%\.promptholm, and a session hook is added to %USERPROFILE%\.claude\settings.json
(backed up first; a Promptholm hook that is already there is left alone). Because your
island lives there and not in this folder, you can unpack a newer version over this one,
or move the folder, without losing it. An island you already had - from an older release
in %LOCALAPPDATA%\Promptholm, or a checkout of the source - is copied in instead, and the
old copy is left where it was as a backup.

The exes are not signed, so Windows may say "Windows protected your PC" the first time:
"More info" -> "Run anyway". If the zip was downloaded, unblock it before unpacking
(right click -> Properties -> Unblock, or `Unblock-File` in PowerShell).
