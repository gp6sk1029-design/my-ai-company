"""
EC販売部門 - メルカリ出品管理アプリ（ネイティブGUI版）
Chrome不要。macOSのネイティブウィンドウで動作する。

機能:
  1. 商品名を入力 + 写真を選択 → Google Driveにアップロード
  2. ダッシュボード: 出品一覧・利益をテーブル表示

起動方法:
    python3 ec/scripts/mercari_app.py
"""

import os
import sys
import json
import base64
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from datetime import datetime

# パス設定
sys.path.insert(0, os.path.dirname(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")


# ── Google Drive 操作 ──

_drive_service = None

def get_drive():
    global _drive_service
    if _drive_service is None:
        from google_drive import get_drive_service
        _drive_service = get_drive_service()
    return _drive_service


def upload_to_drive(product_name, photo_paths, progress_callback=None):
    """写真をGoogle Driveにアップロード"""
    service = get_drive()

    # ルートフォルダ「メルカリ」取得
    from google_drive import get_root_folder_id
    root_id = get_root_folder_id(service)
    if not root_id:
        meta = {"name": "メルカリ", "mimeType": "application/vnd.google-apps.folder"}
        folder = service.files().create(body=meta, fields="id").execute()
        root_id = folder["id"]

    # 商品フォルダ取得/作成
    q = f"name='{product_name}' and '{root_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
    results = service.files().list(q=q, fields="files(id)").execute()
    files_list = results.get("files", [])

    if files_list:
        folder_id = files_list[0]["id"]
    else:
        meta = {"name": product_name, "mimeType": "application/vnd.google-apps.folder", "parents": [root_id]}
        folder = service.files().create(body=meta, fields="id").execute()
        folder_id = folder["id"]

    # 写真アップロード
    from googleapiclient.http import MediaFileUpload
    saved = []
    for i, path in enumerate(photo_paths):
        if progress_callback:
            progress_callback(i + 1, len(photo_paths))

        media = MediaFileUpload(path, mimetype="image/jpeg")
        file_meta = {"name": os.path.basename(path), "parents": [folder_id]}
        uploaded = service.files().create(body=file_meta, media_body=media, fields="id,name").execute()
        saved.append(uploaded["name"])

    return {"success": True, "count": len(saved), "folder_id": folder_id, "files": saved}


def get_dashboard_data():
    """スプレッドシートからダッシュボードデータを取得"""
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
        spreadsheet_id = config.get("spreadsheet_id", "")
        if not spreadsheet_id or spreadsheet_id == "YOUR_SPREADSHEET_ID_HERE":
            return []

        from sheets_sync import get_sheets_service, SHEET_NAME
        service = get_sheets_service()
        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=f"{SHEET_NAME}!A:J"
        ).execute()

        data = result.get("values", [])
        if len(data) <= 1:
            return []

        headers = data[0]
        rows = []
        for row in data[1:]:
            obj = {}
            for i, h in enumerate(headers):
                obj[h] = row[i] if i < len(row) else ""
            if obj.get("商品名"):
                rows.append(obj)
        return list(reversed(rows))
    except Exception as e:
        print(f"ダッシュボードデータ取得エラー: {e}")
        return []


# ── GUI アプリケーション ──

class MercariApp:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("📦 メルカリ出品管理")
        self.root.geometry("900x650")
        self.root.configure(bg="#f5f5f5")

        # macOS向け設定
        self.root.option_add("*Font", "ヒラギノ角ゴシック 13")

        self.photo_paths = []
        self.setup_ui()

    def setup_ui(self):
        """UIを構築"""
        # タブコントロール
        style = ttk.Style()
        style.theme_use("aqua" if sys.platform == "darwin" else "default")
        style.configure("TNotebook.Tab", font=("ヒラギノ角ゴシック", 14, "bold"), padding=[20, 8])

        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        # タブ1: アップロード
        self.upload_frame = tk.Frame(self.notebook, bg="#f5f5f5")
        self.notebook.add(self.upload_frame, text="📷 アップロード")

        # タブ2: ダッシュボード
        self.dash_frame = tk.Frame(self.notebook, bg="#f5f5f5")
        self.notebook.add(self.dash_frame, text="📊 ダッシュボード")

        self.setup_upload_tab()
        self.setup_dashboard_tab()

        # ダッシュボードタブが選ばれたときにデータ読み込み
        self.notebook.bind("<<NotebookTabChanged>>", self.on_tab_changed)

    def setup_upload_tab(self):
        """アップロードタブ"""
        frame = self.upload_frame

        # 商品名
        tk.Label(frame, text="商品名", font=("ヒラギノ角ゴシック", 13, "bold"),
                 bg="#f5f5f5", anchor="w").pack(fill=tk.X, padx=20, pady=(20, 5))

        self.name_entry = tk.Entry(frame, font=("ヒラギノ角ゴシック", 16),
                                   relief=tk.SOLID, bd=1)
        self.name_entry.pack(fill=tk.X, padx=20, ipady=8)
        self.name_entry.insert(0, "")
        self.name_entry.config(
            insertbackground="red",
            highlightthickness=2,
            highlightcolor="#ff4d4d"
        )

        # 写真選択ボタン
        btn_frame = tk.Frame(frame, bg="#f5f5f5")
        btn_frame.pack(fill=tk.X, padx=20, pady=15)

        tk.Button(btn_frame, text="📷 写真を選択",
                  font=("ヒラギノ角ゴシック", 14),
                  command=self.select_photos,
                  relief=tk.RAISED, bd=1,
                  padx=20, pady=10).pack(side=tk.LEFT)

        tk.Button(btn_frame, text="🗑 選択をクリア",
                  font=("ヒラギノ角ゴシック", 12),
                  command=self.clear_photos,
                  fg="#888").pack(side=tk.LEFT, padx=10)

        # 選択済み写真の表示
        self.photo_label = tk.Label(frame, text="写真が選択されていません",
                                    font=("ヒラギノ角ゴシック", 12),
                                    bg="#f5f5f5", fg="#888")
        self.photo_label.pack(fill=tk.X, padx=20)

        self.photo_listbox = tk.Listbox(frame, font=("ヒラギノ角ゴシック", 11),
                                        height=5, relief=tk.SOLID, bd=1)
        self.photo_listbox.pack(fill=tk.X, padx=20, pady=5)

        # プログレスバー
        self.progress_var = tk.DoubleVar()
        self.progress_bar = ttk.Progressbar(frame, variable=self.progress_var,
                                             maximum=100, length=400)
        self.progress_bar.pack(fill=tk.X, padx=20, pady=5)

        self.progress_label = tk.Label(frame, text="",
                                       font=("ヒラギノ角ゴシック", 11),
                                       bg="#f5f5f5", fg="#666")
        self.progress_label.pack(padx=20)

        # アップロードボタン
        self.upload_btn = tk.Button(
            frame, text="☁️ Google Drive にアップロード",
            font=("ヒラギノ角ゴシック", 16, "bold"),
            bg="#ff4d4d", fg="white",
            activebackground="#cc3333", activeforeground="white",
            command=self.start_upload,
            relief=tk.FLAT, bd=0,
            padx=30, pady=12
        )
        self.upload_btn.pack(pady=20)

        # 結果メッセージ
        self.result_label = tk.Label(frame, text="",
                                     font=("ヒラギノ角ゴシック", 13),
                                     bg="#f5f5f5", wraplength=500)
        self.result_label.pack(padx=20, pady=5)

    def setup_dashboard_tab(self):
        """ダッシュボードタブ"""
        frame = self.dash_frame

        # サマリー
        self.summary_frame = tk.Frame(frame, bg="#f5f5f5")
        self.summary_frame.pack(fill=tk.X, padx=20, pady=15)

        self.sum_labels = {}
        for i, (key, label) in enumerate([
            ("listed", "出品中"), ("sold", "売約済み"), ("profit", "累計利益")
        ]):
            f = tk.Frame(self.summary_frame, bg="white", relief=tk.SOLID, bd=1)
            f.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=5)
            val = tk.Label(f, text="-", font=("ヒラギノ角ゴシック", 22, "bold"),
                          bg="white", fg="#2e7d32" if key == "profit" else "#222")
            val.pack(pady=(10, 2))
            tk.Label(f, text=label, font=("ヒラギノ角ゴシック", 11),
                    bg="white", fg="#888").pack(pady=(0, 10))
            self.sum_labels[key] = val

        # 更新ボタン
        tk.Button(frame, text="🔄 更新", font=("ヒラギノ角ゴシック", 12),
                  command=self.load_dashboard).pack(anchor="w", padx=20, pady=5)

        # テーブル
        cols = ("商品名", "出品価格", "利益", "利益率", "送料", "発送方法", "ステータス", "出品日")
        self.tree = ttk.Treeview(frame, columns=cols, show="headings", height=15)

        for col in cols:
            w = 120 if col == "商品名" else 80
            self.tree.heading(col, text=col)
            self.tree.column(col, width=w, anchor="center" if col != "商品名" else "w")

        self.tree.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)

        # スクロールバー
        scrollbar = ttk.Scrollbar(frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)

    # ── アクション ──

    def select_photos(self):
        """写真を選択"""
        paths = filedialog.askopenfilenames(
            title="商品写真を選択",
            filetypes=[("画像ファイル", "*.jpg *.jpeg *.png *.heic *.webp"), ("すべて", "*.*")]
        )
        if paths:
            self.photo_paths.extend(paths)
            self.update_photo_list()

    def clear_photos(self):
        """選択をクリア"""
        self.photo_paths = []
        self.update_photo_list()

    def update_photo_list(self):
        """写真リストを更新"""
        self.photo_listbox.delete(0, tk.END)
        for p in self.photo_paths:
            self.photo_listbox.insert(tk.END, f"  📷 {os.path.basename(p)}")
        count = len(self.photo_paths)
        self.photo_label.config(
            text=f"{count}枚選択済み" if count > 0 else "写真が選択されていません",
            fg="#222" if count > 0 else "#888"
        )

    def start_upload(self):
        """アップロード開始（別スレッド）"""
        product_name = self.name_entry.get().strip()
        if not product_name:
            messagebox.showwarning("入力エラー", "商品名を入力してください")
            return
        if not self.photo_paths:
            messagebox.showwarning("入力エラー", "写真を選択してください")
            return

        self.upload_btn.config(state=tk.DISABLED, text="アップロード中...")
        self.result_label.config(text="", fg="#222")
        self.progress_var.set(0)

        # 別スレッドでアップロード
        thread = threading.Thread(
            target=self._do_upload,
            args=(product_name, list(self.photo_paths)),
            daemon=True
        )
        thread.start()

    def _do_upload(self, product_name, paths):
        """アップロード処理（バックグラウンド）"""
        try:
            def on_progress(current, total):
                pct = current / total * 100
                self.root.after(0, lambda: self.progress_var.set(pct))
                self.root.after(0, lambda: self.progress_label.config(
                    text=f"アップロード中... {current}/{total}枚"))

            result = upload_to_drive(product_name, paths, on_progress)

            if result["success"]:
                self.root.after(0, lambda: self._upload_success(result))
            else:
                self.root.after(0, lambda: self._upload_error("アップロードに失敗しました"))

        except Exception as e:
            self.root.after(0, lambda: self._upload_error(str(e)))

    def _upload_success(self, result):
        """アップロード成功"""
        self.upload_btn.config(state=tk.NORMAL, text="☁️ Google Drive にアップロード")
        self.result_label.config(
            text=f"✅ {result['count']}枚の写真をDriveに保存しました！",
            fg="#2e7d32"
        )
        self.progress_label.config(text="完了！")
        # リセット
        self.name_entry.delete(0, tk.END)
        self.photo_paths = []
        self.update_photo_list()

    def _upload_error(self, error):
        """アップロードエラー"""
        self.upload_btn.config(state=tk.NORMAL, text="☁️ Google Drive にアップロード")
        self.result_label.config(text=f"❌ エラー: {error}", fg="#c62828")
        self.progress_label.config(text="")

    # ── ダッシュボード ──

    def on_tab_changed(self, event):
        """タブ切り替え時"""
        if self.notebook.index(self.notebook.select()) == 1:
            self.load_dashboard()

    def load_dashboard(self):
        """ダッシュボードデータを読み込み"""
        self.tree.delete(*self.tree.get_children())
        threading.Thread(target=self._load_dashboard_bg, daemon=True).start()

    def _load_dashboard_bg(self):
        """バックグラウンドでデータ取得"""
        rows = get_dashboard_data()
        self.root.after(0, lambda: self._render_dashboard(rows))

    def _render_dashboard(self, rows):
        """ダッシュボードを描画"""
        # サマリー
        listed = sum(1 for r in rows if r.get("ステータス") == "出品中")
        sold = sum(1 for r in rows if r.get("ステータス") in ("売約済み", "発送済み", "完了"))
        profit = sum(int(r.get("利益", 0) or 0) for r in rows)

        self.sum_labels["listed"].config(text=str(listed))
        self.sum_labels["sold"].config(text=str(sold))
        self.sum_labels["profit"].config(text=f"¥{profit:,}")

        # テーブル
        self.tree.delete(*self.tree.get_children())
        for r in rows:
            values = (
                r.get("商品名", ""),
                f"¥{int(r.get('出品価格', 0) or 0):,}",
                f"¥{int(r.get('利益', 0) or 0):,}",
                f"{float(r.get('利益率', 0) or 0):.1f}%",
                f"¥{int(r.get('送料', 0) or 0):,}",
                r.get("発送方法", ""),
                r.get("ステータス", ""),
                str(r.get("出品日", ""))[:10],
            )
            self.tree.insert("", tk.END, values=values)

    def run(self):
        """アプリを起動"""
        self.root.mainloop()


if __name__ == "__main__":
    print("📦 メルカリ出品管理アプリを起動中...")
    app = MercariApp()
    app.run()
