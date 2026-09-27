@echo off
setlocal
node.exe "%~dp0hosting\host-control.mjs" restart --config "%~dp0config.json"
exit /b %errorlevel%
