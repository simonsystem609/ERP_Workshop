@echo off
setlocal
rem Generic source wrapper. The shared host adapter currently fails closed.
node.exe "%~dp0hosting\host-control.mjs" install --config "%~dp0config.json"
exit /b %errorlevel%
