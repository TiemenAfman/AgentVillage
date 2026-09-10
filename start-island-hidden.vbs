' Starts the island server with no console window, and keeps everything it prints,
' crashes included, in data\server.log. Used by the scheduled task.
' If the server is already running, serve.mjs notices the port is taken and exits quietly.
Dim sh, fso, root, node, logFile, cmd
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
node = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not fso.FileExists(node) Then node = "node"

If Not fso.FolderExists(root & "\data") Then fso.CreateFolder(root & "\data")
logFile = root & "\data\server.log"

sh.CurrentDirectory = root
cmd = "cmd /c """"" & node & """ """ & root & "\serve.mjs"" >> """ & logFile & """ 2>&1"""
sh.Run cmd, 0, False
