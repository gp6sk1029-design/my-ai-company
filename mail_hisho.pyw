#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# メール秘書 ランチャー（英語パス経由）
import subprocess, sys, os, traceback
from pathlib import Path

log_path = Path(__file__).parent / "mail_hisho_error.log"

try:
    target = Path(__file__).parent / ".claude" / "worktrees" / "priceless-liskov" / "work" / "companies" / "一宮電機" / "email" / "メール秘書.pyw"
    os.chdir(target.parent)
    result = subprocess.run(
        [sys.executable, str(target)],
        stderr=subprocess.PIPE,
        text=True, encoding="utf-8", errors="replace"
    )
    if result.stderr:
        log_path.write_text(result.stderr, encoding="utf-8")
except Exception:
    log_path.write_text(traceback.format_exc(), encoding="utf-8")
