#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# メール秘書 ランチャー（英語パス経由）
import subprocess, sys, os
from pathlib import Path

target = Path(__file__).parent / ".claude" / "worktrees" / "priceless-liskov" / "work" / "companies" / "一宮電機" / "email" / "メール秘書.pyw"
os.chdir(target.parent)
subprocess.run([sys.executable, str(target)])
