"""Serve ui/ for browser development without Tauri, with caching disabled.

Usage: python tools/serve_ui.py [port] [dir]   (default 4791 and ui/, bound to 127.0.0.1)

Archived looks run the same way on their own port, so their saved settings stay separate:
python tools/serve_ui.py 4792 archive/looks-2026-10/ui
"""

import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4791
    ui = (ROOT / sys.argv[2]) if len(sys.argv) > 2 else ROOT / "ui"
    if not (ui / "index.html").is_file():
        sys.exit(f"no index.html in {ui}")
    handler = functools.partial(NoCache, directory=str(ui))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as srv:
        print(f"Collegiapp UI ({ui.relative_to(ROOT)}) on http://127.0.0.1:{port}/", flush=True)
        srv.serve_forever()
