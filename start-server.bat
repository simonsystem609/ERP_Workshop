@echo off
setlocal
node.exe "%~dp0hosting\host-control.mjs" start --config "%~dp0config.json"
exit /b %errorlevel%
