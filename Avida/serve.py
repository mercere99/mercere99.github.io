#!/usr/bin/env python3
"""Serve Avida; opt into isolation headers with --threaded."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8080, help='local port (default: 8080)')
    parser.add_argument('--threaded', action='store_true', help='send COOP/COEP headers for threaded builds')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('--port must be between 1 and 65535')
    handler = partial(CORSRequestHandler if args.threaded else SimpleHTTPRequestHandler, directory=str(Path(__file__).resolve().parent))
    try:
        httpd = ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    except OSError as error:
        print(f'Could not start the Avida server: {error}', file=sys.stderr)
        print('If the port is in use, try: python3 web/serve.py --port 8081', file=sys.stderr)
        return 1
    with httpd:
        suffix = '?execution=threaded' if args.threaded else ''
        print(f'Open http://127.0.0.1:{args.port}/Avida.html{suffix}', flush=True)
        print('Keep this terminal open. Press Ctrl+C to stop.', flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
