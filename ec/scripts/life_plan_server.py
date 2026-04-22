"""ライフプランくん ローカル開発サーバ。
python3 server.py で起動し、 http://localhost:8791 を開く。
Cloudflare Pages Functions は dev では使わず、静的ファイルだけ配信する。
"""
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8791
ROOT = "/Users/shoheikoda/Documents/my-ai-company/private/life-plan/public"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, format, *args):
        sys.stderr.write("[life-plan] " + (format % args) + "\n")


def main():
    print(f"[life-plan] serving {ROOT} on http://localhost:{PORT}")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
