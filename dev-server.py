#!/usr/bin/env python3
import http.server
import os
import sys
import socketserver

os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = 1420

handler = http.server.SimpleHTTPRequestHandler
handler.extensions_map.update({
    '.skel': 'application/octet-stream',
    '.atlas': 'text/plain',
})

class ReusableHTTPServer(http.server.HTTPServer):
    allow_reuse_address = True

server = ReusableHTTPServer(('127.0.0.1', port), handler)
print(f"Dev server running at http://localhost:{port}/")
sys.stdout.flush()
server.serve_forever()
