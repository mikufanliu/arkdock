#!/usr/bin/env python3
import http.server
import os
import sys
import shutil

os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = 1420

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = http.server.SimpleHTTPRequestHandler.extensions_map.copy()
    extensions_map.update({
        '.skel': 'application/octet-stream',
        '.atlas': 'text/plain',
    })

    def do_GET(self):
        # Override to always send 200, never 304
        f = self.send_head_no_cache()
        if f:
            try:
                shutil.copyfileobj(f, self.wfile)
            finally:
                f.close()

    def send_head_no_cache(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            parts = self.path.split('?', 1)
            if not parts[0].endswith('/'):
                self.send_response(301)
                new_parts = (parts[0] + '/',) + tuple(parts[1:])
                self.send_header("Location", '?'.join(new_parts))
                self.end_headers()
                return None
            for index in "index.html", "index.htm":
                index_path = os.path.join(path, index)
                if os.path.exists(index_path):
                    path = index_path
                    break
            else:
                return super().send_head()

        try:
            f = open(path, 'rb')
        except OSError:
            self.send_error(404, "File not found")
            return None

        ctype = self.guess_type(path)
        fs = os.fstat(f.fileno())
        self.send_response(200)
        self.send_header("Content-type", ctype)
        self.send_header("Content-Length", str(fs.st_size))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.end_headers()
        return f

class ReusableHTTPServer(http.server.HTTPServer):
    allow_reuse_address = True

server = ReusableHTTPServer(('127.0.0.1', port), NoCacheHandler)
print(f"Dev server running at http://localhost:{port}/")
sys.stdout.flush()
server.serve_forever()
