@echo off
setlocal
rem Never launch from a wrong share or start a stale host; the adapter must approve.
node.exe "%~dp0hosting\host-control.mjs" watch --config "%~dp0config.json"
exit /b %errorlevel%
