@echo off
rem Opens the island as its own window instead of a browser tab.
rem The server is started first if it is not already running.
setlocal
set DIR=%~dp0
set URL=http://localhost:4747/

netstat -ano | findstr /r /c:"LISTENING" | findstr ":4747 " >nul 2>&1
if errorlevel 1 (
  wscript.exe "%DIR%start-island-hidden.vbs"
  timeout /t 5 /nobreak >nul
)

set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe

if exist "%CHROME%" (
  rem --force-high-performance-gpu: on a laptop with two graphics cards Chromium picks the
  rem integrated one to save power, whatever Windows' per-app preference says. Here that is
  rem the card whose driver keeps falling over, so ask for the fast one explicitly.
  start "" "%CHROME%" --app=%URL% --window-size=1600,1000 --force-high-performance-gpu
) else (
  start "" %URL%
)
endlocal
