#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
キーワード管理GUI
ダブルクリックで起動して、ボタンでキーワード・除外送信者を管理する
"""

import json
import tkinter as tk
from tkinter import ttk, messagebox
from pathlib import Path

KEYWORDS_FILE = Path(__file__).parent / "keywords.json"


def load():
    with open(KEYWORDS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save(data: dict):
    with open(KEYWORDS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


class KeywordApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("返信不要キーワード管理")
        self.geometry("520x580")
        self.resizable(False, False)
        self.configure(bg="#1e1e2e")
        self.build_ui()
        self.refresh()

    def build_ui(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("TNotebook", background="#1e1e2e", borderwidth=0)
        style.configure("TNotebook.Tab", background="#313244", foreground="white",
                        padding=[12, 6], font=("Yu Gothic UI", 10))
        style.map("TNotebook.Tab", background=[("selected", "#89b4fa")])
        style.configure("TFrame", background="#1e1e2e")
        style.configure("TLabel", background="#1e1e2e", foreground="white",
                        font=("Yu Gothic UI", 10))
        style.configure("TButton", font=("Yu Gothic UI", 10), padding=6)
        style.configure("TListbox", font=("Yu Gothic UI", 10))

        # タブ
        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=True, padx=12, pady=12)

        self.tab_kw     = ttk.Frame(nb)
        self.tab_sender = ttk.Frame(nb)
        self.tab_learn  = ttk.Frame(nb)
        nb.add(self.tab_kw,     text="  キーワード  ")
        nb.add(self.tab_sender, text="  除外送信者  ")
        nb.add(self.tab_learn,  text="  自動学習済み  ")

        self._build_tab(self.tab_kw,     "手動キーワード",
                        "件名・送信者にこの文字が含まれたらスキップします",
                        "kw")
        self._build_tab(self.tab_sender, "除外送信者",
                        "このメールアドレスからのメールはスキップします",
                        "sender")
        self._build_tab(self.tab_learn,  "自動学習済み",
                        "自動で学習された送信者（編集・削除できます）",
                        "learn")

    def _build_tab(self, parent, title, desc, tag):
        ttk.Label(parent, text=desc, foreground="#a6adc8").pack(anchor="w", padx=10, pady=(10, 4))

        frame = tk.Frame(parent, bg="#1e1e2e")
        frame.pack(fill="both", expand=True, padx=10, pady=4)

        sb = tk.Scrollbar(frame)
        sb.pack(side="right", fill="y")

        lb = tk.Listbox(frame, yscrollcommand=sb.set, font=("Yu Gothic UI", 11),
                        bg="#313244", fg="white", selectbackground="#89b4fa",
                        selectforeground="#1e1e2e", relief="flat",
                        highlightthickness=1, highlightcolor="#585b70",
                        activestyle="none", height=10)
        lb.pack(side="left", fill="both", expand=True)
        sb.config(command=lb.yview)
        setattr(self, f"lb_{tag}", lb)

        # 入力欄＋追加ボタン
        bottom = tk.Frame(parent, bg="#1e1e2e")
        bottom.pack(fill="x", padx=10, pady=(4, 10))

        entry = tk.Entry(bottom, font=("Yu Gothic UI", 11),
                         bg="#313244", fg="white", insertbackground="white",
                         relief="flat", highlightthickness=1, highlightcolor="#89b4fa")
        entry.pack(side="left", fill="x", expand=True, ipady=6, padx=(0, 6))
        setattr(self, f"entry_{tag}", entry)

        add_btn = tk.Button(bottom, text="追加", font=("Yu Gothic UI", 10, "bold"),
                            bg="#89b4fa", fg="#1e1e2e", relief="flat",
                            padx=14, pady=6, cursor="hand2",
                            command=lambda t=tag: self.add_item(t))
        add_btn.pack(side="left", padx=(0, 4))

        del_btn = tk.Button(bottom, text="削除", font=("Yu Gothic UI", 10),
                            bg="#f38ba8", fg="#1e1e2e", relief="flat",
                            padx=14, pady=6, cursor="hand2",
                            command=lambda t=tag: self.delete_item(t))
        del_btn.pack(side="left")

        # Enterキーでも追加
        entry.bind("<Return>", lambda e, t=tag: self.add_item(t))

    def refresh(self):
        data = load()
        self._fill_listbox(self.lb_kw,     data["手動キーワード"])
        self._fill_listbox(self.lb_sender, data["除外送信者"])
        self._fill_listbox(self.lb_learn,  data["自動学習"])

    def _fill_listbox(self, lb, items):
        lb.delete(0, tk.END)
        for item in items:
            lb.insert(tk.END, f"  {item}")

    def add_item(self, tag):
        entry = getattr(self, f"entry_{tag}")
        value = entry.get().strip()
        if not value:
            return

        data = load()
        key_map = {"kw": "手動キーワード", "sender": "除外送信者", "learn": "自動学習"}
        key = key_map[tag]

        if value in data[key]:
            messagebox.showinfo("確認", f"「{value}」はすでに登録されています。")
            return

        data[key].append(value)
        save(data)
        entry.delete(0, tk.END)
        self.refresh()

    def delete_item(self, tag):
        lb = getattr(self, f"lb_{tag}")
        sel = lb.curselection()
        if not sel:
            messagebox.showinfo("確認", "削除する項目を選択してください。")
            return

        value = lb.get(sel[0]).strip()
        if not messagebox.askyesno("削除確認", f"「{value}」を削除しますか？"):
            return

        data = load()
        key_map = {"kw": "手動キーワード", "sender": "除外送信者", "learn": "自動学習"}
        key = key_map[tag]

        if value in data[key]:
            data[key].remove(value)
            save(data)
            self.refresh()


if __name__ == "__main__":
    app = KeywordApp()
    app.mainloop()
