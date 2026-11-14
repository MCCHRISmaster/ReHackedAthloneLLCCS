@echo off
rem Double-click to run all three apps at http://localhost:8000
cd /d "%~dp0"
start "" http://localhost:8000
node prototype\server.js . 8000
