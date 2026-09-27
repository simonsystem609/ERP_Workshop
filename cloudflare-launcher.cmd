@echo off
setlocal
node.exe "%~dp0hosting\host-control.mjs" cloudflare --config "%~dp0config.json"
exit /b %errorlevel%
