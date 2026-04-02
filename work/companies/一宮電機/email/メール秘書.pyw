#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
メール秘書
・自動下書き（ON/OFF）
・キーワード管理
"""

import json
import subprocess
import sys
import tkinter as tk
from tkinter import ttk, messagebox
from pathlib import Path

BASE_DIR      = Path(__file__).parent
KEYWORDS_FILE = BASE_DIR / "keywords.json"
SCRIPT_FILE   = BASE_DIR / "auto_draft.py"

# ── カラーパレット ───────────────────────────────────────────
BG       = "#1e1e2e"
SURFACE  = "#313244"
ACCENT   = "#89b4fa"
GREEN    = "#a6e3a1"
RED      = "#f38ba8"
YELLOW   = "#f9e2af"
TEXT     = "#cdd6f4"
SUBTEXT  = "#a6adc8"


# ── キーワードJSON ───────────────────────────────────────────
def load_kw() -> dict:
    with open(KEYWORDS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_kw(data: dict):
    with open(KEYWORDS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── メインアプリ ─────────────────────────────────────────────
class MailHisho(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("メール秘書")
        self.geometry("480x620")
        self.resizable(False, False)
        self.configure(bg=BG)
        self._process = None  # 自動下書きプロセス

        self._set_icon()
        self._build_ui()

    # ── アイコン生成 ─────────────────────────────────────────
    def _set_icon(self):
        try:
            from PIL import Image, ImageDraw, ImageFont
            import io, base64

            img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
            d   = ImageDraw.Draw(img)
            # 封筒の形
            d.rounded_rectangle([4, 14, 60, 50], radius=6, fill="#89b4fa")
            d.polygon([(4, 14), (32, 34), (60, 14)], fill="#74c7ec")
            # AIマーク
            d.text((22, 36), "AI", fill="#1e1e2e")

            buf = io.BytesIO()
            img.save(buf, format="ICO", sizes=[(64, 64)])
            buf.seek(0)
            icon = tk.PhotoImage(data=base64.b64encode(buf.read()))
            self.iconphoto(True, icon)
        except Exception:
            pass

    # ── UI構築 ───────────────────────────────────────────────
    def _build_ui(self):
        # ヘッダー
        hdr = tk.Frame(self, bg=SURFACE, height=64)
        hdr.pack(fill="x")
        hdr.pack_propagate(False)
        tk.Label(hdr, text="📨  メール秘書", font=("Yu Gothic UI", 16, "bold"),
                 bg=SURFACE, fg=TEXT).pack(side="left", padx=20, pady=14)
        tk.Label(hdr, text="for 一宮電機", font=("Yu Gothic UI", 9),
                 bg=SURFACE, fg=SUBTEXT).pack(side="right", padx=20)

        # タブ
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("TNotebook",        background=BG,      borderwidth=0)
        style.configure("TNotebook.Tab",    background=SURFACE, foreground=TEXT,
                        padding=[14, 8],    font=("Yu Gothic UI", 10))
        style.map("TNotebook.Tab", background=[("selected", ACCENT)],
                  foreground=[("selected", BG)])
        style.configure("TFrame", background=BG)

        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=True, padx=0, pady=0)

        tab1 = ttk.Frame(nb)
        tab2 = ttk.Frame(nb)
        nb.add(tab1, text="  🤖 自動下書き  ")
        nb.add(tab2, text="  🔑 キーワード管理  ")

        self._build_tab_auto(tab1)
        self._build_tab_kw(tab2)

    # ── タブ①：自動下書き ────────────────────────────────────
    def _build_tab_auto(self, parent):
        # ステータス表示
        status_frame = tk.Frame(parent, bg=SURFACE, height=100)
        status_frame.pack(fill="x", padx=16, pady=(20, 8))
        status_frame.pack_propagate(False)

        tk.Label(status_frame, text="ステータス", font=("Yu Gothic UI", 9),
                 bg=SURFACE, fg=SUBTEXT).pack(anchor="w", padx=16, pady=(10, 2))

        self.status_dot = tk.Label(status_frame, text="⏹  停止中",
                                   font=("Yu Gothic UI", 14, "bold"),
                                   bg=SURFACE, fg=RED)
        self.status_dot.pack(anchor="w", padx=16)

        # 説明
        desc = (
            "Thunderbirdが起動中のとき、受信から5分以内の\n"
            "新着メールを検出して自動で下書きを作成します。"
        )
        tk.Label(parent, text=desc, font=("Yu Gothic UI", 10),
                 bg=BG, fg=SUBTEXT, justify="left").pack(anchor="w", padx=20, pady=(8, 0))

        # ON/OFFボタン
        self.toggle_btn = tk.Button(
            parent, text="▶  自動下書きを開始",
            font=("Yu Gothic UI", 13, "bold"),
            bg=GREEN, fg=BG, relief="flat",
            padx=20, pady=14, cursor="hand2",
            command=self.toggle_auto
        )
        self.toggle_btn.pack(fill="x", padx=20, pady=16)

        # ログ表示
        tk.Label(parent, text="ログ", font=("Yu Gothic UI", 9),
                 bg=BG, fg=SUBTEXT).pack(anchor="w", padx=20)

        log_frame = tk.Frame(parent, bg=SURFACE)
        log_frame.pack(fill="both", expand=True, padx=16, pady=(4, 16))

        sb = tk.Scrollbar(log_frame)
        sb.pack(side="right", fill="y")

        self.log_box = tk.Text(log_frame, yscrollcommand=sb.set,
                               font=("Consolas", 9),
                               bg=SURFACE, fg=TEXT,
                               relief="flat", state="disabled",
                               height=10)
        self.log_box.pack(fill="both", expand=True, padx=4, pady=4)
        sb.config(command=self.log_box.yview)

    def toggle_auto(self):
        if self._process is None or self._process.poll() is not None:
            # 開始
            self._process = subprocess.Popen(
                [sys.executable, str(SCRIPT_FILE)],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            self.status_dot.config(text="▶  稼働中", fg=GREEN)
            self.toggle_btn.config(text="⏹  自動下書きを停止", bg=RED)
            self._log("自動下書きを開始しました。")
            self._poll_log()
        else:
            # 停止
            self._process.terminate()
            self._process = None
            self.status_dot.config(text="⏹  停止中", fg=RED)
            self.toggle_btn.config(text="▶  自動下書きを開始", bg=GREEN)
            self._log("自動下書きを停止しました。")

    def _log(self, msg: str):
        self.log_box.config(state="normal")
        self.log_box.insert("end", msg + "\n")
        self.log_box.see("end")
        self.log_box.config(state="disabled")

    def _poll_log(self):
        if self._process and self._process.poll() is None:
            try:
                line = self._process.stdout.readline()
                if line:
                    self._log(line.rstrip())
            except Exception:
                pass
            self.after(500, self._poll_log)

    # ── タブ②：キーワード管理 ────────────────────────────────
    def _build_tab_kw(self, parent):
        style = ttk.Style()
        style.configure("TNotebook.Inner", background=BG)

        inner_nb = ttk.Notebook(parent)
        inner_nb.pack(fill="both", expand=True, padx=12, pady=12)

        tabs = [
            ("手動キーワード", "kw",     "件名・送信者にこの文字が含まれたらスキップ"),
            ("除外送信者",   "sender", "このアドレスからのメールはスキップ"),
            ("自動学習済み", "learn",  "自動で記録された送信者"),
        ]
        for label, tag, desc in tabs:
            f = ttk.Frame(inner_nb)
            inner_nb.add(f, text=f"  {label}  ")
            self._build_kw_tab(f, tag, desc)

    def _build_kw_tab(self, parent, tag, desc):
        tk.Label(parent, text=desc, font=("Yu Gothic UI", 9),
                 bg=BG, fg=SUBTEXT).pack(anchor="w", padx=8, pady=(8, 4))

        frame = tk.Frame(parent, bg=BG)
        frame.pack(fill="both", expand=True, padx=8)

        sb = tk.Scrollbar(frame)
        sb.pack(side="right", fill="y")

        lb = tk.Listbox(frame, yscrollcommand=sb.set,
                        font=("Yu Gothic UI", 11),
                        bg=SURFACE, fg=TEXT,
                        selectbackground=ACCENT, selectforeground=BG,
                        relief="flat", highlightthickness=0,
                        activestyle="none", height=9)
        lb.pack(side="left", fill="both", expand=True)
        sb.config(command=lb.yview)
        setattr(self, f"lb_{tag}", lb)

        bottom = tk.Frame(parent, bg=BG)
        bottom.pack(fill="x", padx=8, pady=8)

        entry = tk.Entry(bottom, font=("Yu Gothic UI", 11),
                         bg=SURFACE, fg=TEXT, insertbackground=TEXT,
                         relief="flat", highlightthickness=1,
                         highlightcolor=ACCENT, highlightbackground=SURFACE)
        entry.pack(side="left", fill="x", expand=True, ipady=7, padx=(0, 6))
        setattr(self, f"entry_{tag}", entry)

        tk.Button(bottom, text="追加", font=("Yu Gothic UI", 10, "bold"),
                  bg=ACCENT, fg=BG, relief="flat",
                  padx=12, pady=7, cursor="hand2",
                  command=lambda t=tag: self.kw_add(t)).pack(side="left", padx=(0, 4))

        tk.Button(bottom, text="削除", font=("Yu Gothic UI", 10),
                  bg=RED, fg=BG, relief="flat",
                  padx=12, pady=7, cursor="hand2",
                  command=lambda t=tag: self.kw_delete(t)).pack(side="left")

        entry.bind("<Return>", lambda e, t=tag: self.kw_add(t))
        self.kw_refresh(tag)

    def kw_refresh(self, tag):
        lb  = getattr(self, f"lb_{tag}")
        key = {"kw": "手動キーワード", "sender": "除外送信者", "learn": "自動学習"}[tag]
        lb.delete(0, tk.END)
        for item in load_kw().get(key, []):
            lb.insert(tk.END, f"  {item}")

    def kw_add(self, tag):
        entry = getattr(self, f"entry_{tag}")
        value = entry.get().strip()
        if not value:
            return
        key  = {"kw": "手動キーワード", "sender": "除外送信者", "learn": "自動学習"}[tag]
        data = load_kw()
        if value in data[key]:
            messagebox.showinfo("確認", f"「{value}」はすでに登録されています。")
            return
        data[key].append(value)
        save_kw(data)
        entry.delete(0, tk.END)
        self.kw_refresh(tag)

    def kw_delete(self, tag):
        lb    = getattr(self, f"lb_{tag}")
        sel   = lb.curselection()
        if not sel:
            messagebox.showinfo("確認", "削除する項目を選択してください。")
            return
        value = lb.get(sel[0]).strip()
        if not messagebox.askyesno("削除確認", f"「{value}」を削除しますか？"):
            return
        key  = {"kw": "手動キーワード", "sender": "除外送信者", "learn": "自動学習"}[tag]
        data = load_kw()
        if value in data[key]:
            data[key].remove(value)
            save_kw(data)
            self.kw_refresh(tag)

    def on_close(self):
        if self._process and self._process.poll() is None:
            if messagebox.askyesno("確認", "自動下書きが稼働中です。終了しますか？"):
                self._process.terminate()
                self.destroy()
        else:
            self.destroy()


if __name__ == "__main__":
    app = MailHisho()
    app.protocol("WM_DELETE_WINDOW", app.on_close)
    app.mainloop()
