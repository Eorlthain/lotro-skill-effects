# -*- coding: utf-8 -*-
"""
serve.py - a local server for previewing the site.

The site uses real paths (/skill/123) rather than hash routes, so a plain
`python -m http.server` returns 404 for every page but the front one - it has
no file at that address. GitHub Pages solves that with 404.html; this does the
same thing locally by serving index.html for any path that is not a real file.

    python serve.py            http://localhost:8000
    python serve.py 9000       a different port
"""

import http.server
import os
import posixpath
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))


class SPA(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def send_head(self):
        path = urllib.parse.urlparse(self.path).path
        rel = posixpath.normpath(urllib.parse.unquote(path)).lstrip("/")
        full = os.path.join(HERE, rel.replace("/", os.sep))
        # A real file is served as it is. A route is not a file - and rather
        # than serving index.html AT that address (which would leave every
        # relative URL in it resolving against /skill/, so style.css and app.js
        # would 404), bounce it exactly the way 404.html does in production, so
        # what is tested here is what ships.
        if rel and rel != "index.html" and not os.path.exists(full):
            self.send_response(302)
            self.send_header("Location", "/?/" + rel.replace("&", "~and~"))
            self.end_headers()
            return None
        return super().send_head()

    def log_message(self, fmt, *args):
        if "/data/" in self.path or "/icons/" in self.path:
            return          # thousands of these per page; only routes matter
        super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print("serving %s on http://localhost:%d/  (ctrl-c to stop)" % (HERE, port))
    http.server.ThreadingHTTPServer(("", port), SPA).serve_forever()


if __name__ == "__main__":
    main()
