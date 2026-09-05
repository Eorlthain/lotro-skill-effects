@echo off
REM Preview the site, and open it in a browser.
REM Real paths need a server that falls back to index.html, which plain
REM http.server does not do - see serve.py. Pass a port to use a different one,
REM or --no-browser to skip opening a tab.
cd /d "%~dp0"
python serve.py %*
