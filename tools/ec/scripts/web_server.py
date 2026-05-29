"""
EC販売部門 - ローカルWebサーバー
Google Apps Script の iframe 制限を回避するため、
ローカルで直接HTMLを配信する。PC・スマホ両方からアクセス可能。

起動方法:
    python3 ec/scripts/web_server.py

アクセス:
    PC:     http://localhost:8080
    スマホ:  http://<PCのIPアドレス>:8080  （同じWiFi内）
"""

import os
import sys
import json
import socket
import base64
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

# 同一パッケージのモジュール
sys.path.insert(0, os.path.dirname(__file__))

BASE_DIR = os.path.dirname(os.path.dirname(__file__))

# 遅延インポート（サーバー起動を高速化）
_drive_service = None
_sheets_synced = False


def _get_drive():
    global _drive_service
    if _drive_service is None:
        from google_drive import get_drive_service
        _drive_service = get_drive_service()
    return _drive_service


# ── HTMLテンプレート ──

HTML_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "apps_script")


def get_local_html():
    """index.html を読み込み、google.script.run の呼び出しを fetch API に置換する"""
    path = os.path.join(HTML_DIR, "index.html")
    with open(path, "r", encoding="utf-8") as f:
        html = f.read()

    # google.script.run をローカル fetch API に置換するスクリプトを挿入
    api_script = """
    <script>
    // ローカルサーバー用API（google.script.run の代替）
    var google = { script: { run: {
      withSuccessHandler: function(cb) { this._ok = cb; return this; },
      withFailureHandler: function(cb) { this._err = cb; return this; },
      uploadPhotos: function(name, photos) {
        var s = this;
        fetch('/api/upload', { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({productName:name, photos:photos})
        }).then(function(r){return r.json()}).then(function(d){if(s._ok)s._ok(d)})
        .catch(function(e){if(s._err)s._err(e)});
      },
      getDashboardData: function() {
        var s = this;
        fetch('/api/dashboard').then(function(r){return r.json()})
        .then(function(d){if(s._ok)s._ok(d)}).catch(function(e){if(s._err)s._err(e)});
      }
    }}};
    </script>
    """
    html = html.replace("</head>", api_script + "\n</head>")
    return html


class MercariHandler(BaseHTTPRequestHandler):
    """HTTPリクエストハンドラー"""

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/" or parsed.path == "/index.html":
            self._serve_html()
        elif parsed.path == "/api/dashboard":
            self._api_dashboard()
        elif parsed.path == "/api/health":
            self._json_response({"status": "ok"})
        elif parsed.path == "/api/listing_queue":
            self._api_listing_queue()
        else:
            self._not_found()

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/upload":
            self._api_upload()
        elif parsed.path == "/api/auto_list":
            self._api_auto_list()
        else:
            self._not_found()

    # ── ページ配信 ──

    def _serve_html(self):
        html = get_local_html()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))

    # ── API: 写真アップロード ──

    def _api_upload(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))

            product_name = body.get("productName", "").strip()
            photos = body.get("photos", [])

            if not product_name:
                self._json_response({"success": False, "error": "商品名を入力してください"})
                return
            if not photos:
                self._json_response({"success": False, "error": "写真が選択されていません"})
                return

            service = _get_drive()

            # ルートフォルダ「メルカリ」を取得
            from google_drive import get_root_folder_id
            root_id = get_root_folder_id(service)

            if not root_id:
                # 作成
                meta = {"name": "メルカリ", "mimeType": "application/vnd.google-apps.folder"}
                folder = service.files().create(body=meta, fields="id").execute()
                root_id = folder["id"]

            # 商品フォルダを取得/作成
            q = f"name='{product_name}' and '{root_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
            results = service.files().list(q=q, fields="files(id)").execute()
            files_list = results.get("files", [])

            if files_list:
                product_folder_id = files_list[0]["id"]
            else:
                meta = {
                    "name": product_name,
                    "mimeType": "application/vnd.google-apps.folder",
                    "parents": [root_id]
                }
                folder = service.files().create(body=meta, fields="id").execute()
                product_folder_id = folder["id"]

            # 写真を保存
            from googleapiclient.http import MediaInMemoryUpload
            saved = []
            for i, photo in enumerate(photos):
                file_data = base64.b64decode(photo["data"])
                media = MediaInMemoryUpload(file_data, mimetype=photo.get("mimeType", "image/jpeg"))
                file_meta = {
                    "name": photo.get("name", f"photo_{i+1}.jpg"),
                    "parents": [product_folder_id]
                }
                uploaded = service.files().create(
                    body=file_meta, media_body=media, fields="id,name"
                ).execute()
                saved.append({"name": uploaded["name"], "id": uploaded["id"]})

            self._json_response({
                "success": True,
                "productName": product_name,
                "folderId": product_folder_id,
                "savedCount": len(saved),
                "files": saved,
                "message": f"{len(saved)}枚の写真を保存しました"
            })

        except Exception as e:
            self._json_response({"success": False, "error": str(e)})

    # ── API: ダッシュボードデータ ──

    def _api_dashboard(self):
        try:
            config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)

            spreadsheet_id = config.get("spreadsheet_id")
            if not spreadsheet_id or spreadsheet_id == "YOUR_SPREADSHEET_ID_HERE":
                self._json_response({"listings": [], "total_listed": 0, "total_sold": 0, "total_profit": 0})
                return

            from sheets_sync import get_sheets_service, SHEET_NAME
            service = get_sheets_service()
            result = service.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id,
                range=f"{SHEET_NAME}!A:J"
            ).execute()

            data = result.get("values", [])
            if len(data) <= 1:
                self._json_response({"listings": [], "total_listed": 0, "total_sold": 0, "total_profit": 0})
                return

            headers = data[0]
            rows = []
            for row in data[1:]:
                obj = {}
                for i, h in enumerate(headers):
                    obj[h] = row[i] if i < len(row) else ""
                if obj.get("商品名"):
                    rows.append(obj)

            rows.reverse()
            total_listed = sum(1 for r in rows if r.get("ステータス") == "出品中")
            total_sold = sum(1 for r in rows if r.get("ステータス") in ("売約済み", "発送済み", "完了"))
            total_profit = sum(int(r.get("利益", 0) or 0) for r in rows)

            self._json_response({
                "listings": rows,
                "total_listed": total_listed,
                "total_sold": total_sold,
                "total_profit": total_profit
            })

        except Exception as e:
            self._json_response({"listings": [], "total_listed": 0, "total_sold": 0, "total_profit": 0, "error": str(e)})

    # ── API: 自動出品キュー ──

    def _api_auto_list(self):
        """自動出品リクエストをキューに追加する"""
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))

            from mercari_browser import can_list_today
            can_list, count, limit = can_list_today()

            if not can_list:
                self._json_response({
                    "success": False,
                    "error": f"本日の出品上限（{limit}件）に達しています（現在{count}件）"
                })
                return

            # キューファイルに保存
            queue_path = os.path.join(BASE_DIR, "data", "listing_queue.json")
            os.makedirs(os.path.dirname(queue_path), exist_ok=True)

            try:
                with open(queue_path, "r", encoding="utf-8") as f:
                    queue = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                queue = []

            from datetime import datetime
            body["queued_at"] = datetime.now().isoformat()
            body["status"] = "pending"
            queue.append(body)

            with open(queue_path, "w", encoding="utf-8") as f:
                json.dump(queue, f, ensure_ascii=False, indent=2)

            self._json_response({
                "success": True,
                "message": f"出品キューに追加しました（本日 {count + 1}/{limit}件目）\n自動出品を開始します...",
                "queue_position": len(queue)
            })

            # バックグラウンドでSelenium出品を実行
            import threading
            def run_selenium():
                import subprocess
                subprocess.Popen(
                    [sys.executable, os.path.join(os.path.dirname(__file__), "mercari_selenium.py")],
                    cwd=os.path.dirname(os.path.dirname(__file__))
                )
            threading.Thread(target=run_selenium, daemon=True).start()

        except Exception as e:
            self._json_response({"success": False, "error": str(e)})

    def _api_listing_queue(self):
        """出品キューの状態を返す"""
        try:
            queue_path = os.path.join(BASE_DIR, "data", "listing_queue.json")
            with open(queue_path, "r", encoding="utf-8") as f:
                queue = json.load(f)
            pending = [q for q in queue if q.get("status") == "pending"]
            self._json_response({"queue": pending, "count": len(pending)})
        except (FileNotFoundError, json.JSONDecodeError):
            self._json_response({"queue": [], "count": 0})

    # ── ユーティリティ ──

    def _json_response(self, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _not_found(self):
        self.send_response(404)
        self.end_headers()
        self.wfile.write(b"Not Found")

    def log_message(self, format, *args):
        """ログをシンプルに"""
        print(f"[{self.log_date_time_string()}] {args[0]}")


def get_local_ip():
    """ローカルIPアドレスを取得"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "不明"


if __name__ == "__main__":
    PORT = 8080
    local_ip = get_local_ip()

    print("=" * 50)
    print("📦 メルカリ出品管理 ローカルサーバー")
    print("=" * 50)
    print(f"\n🖥  PC:     http://localhost:{PORT}")
    print(f"📱 スマホ:  http://{local_ip}:{PORT}")
    print(f"\n(Ctrl+C で停止)")
    print("=" * 50)

    server = HTTPServer(("0.0.0.0", PORT), MercariHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nサーバーを停止しました")
        server.server_close()
