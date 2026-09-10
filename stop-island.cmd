@echo off
rem Stops whatever is serving the island on its port.
setlocal
set PORT=4747
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr ":%PORT% "') do (
  taskkill /f /pid %%p >nul 2>&1 && set FOUND=1
)
if defined FOUND (echo Promptholm stopped.) else (echo Promptholm was not running.)
endlocal
