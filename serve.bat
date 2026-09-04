@echo off
REM Preview the site. Real paths need a server that falls back to index.html,
REM which plain http.server does not do - see serve.py.
cd /d "%~dp0"
python serve.py %*
