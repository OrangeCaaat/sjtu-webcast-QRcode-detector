"""Serve only the synthetic manual acceptance page on this computer."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


if __name__ == '__main__':
    root = Path(__file__).resolve().parent
    try:
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(root)))
        url = f'http://127.0.0.1:{server.server_port}/'
        print('Manual acceptance page (synthetic QR codes only):', flush=True)
        print(url, flush=True)
        print('Copy this URL into Chrome or Edge. Keep this window open; Ctrl+C stops it.', flush=True)
        webbrowser.open(url)
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
    finally:
        if 'server' in locals():
            server.server_close()
