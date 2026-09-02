@echo off
REM Browsers block fetch() from file://, so the site needs a local server.
REM This starts one in this folder and opens it.
start "" http://localhost:8000/
python -m http.server 8000
