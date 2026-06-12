#!/bin/bash
# リベ関係まとめポータルをChromeで開く（ダブルクリック起動用）
# 正本: my-ai-company/research/リベまとめを開く.command（デスクトップが消えたらここからコピー）
open -a "Google Chrome" "$(cd "$(dirname "$0")" && pwd)/reports/リベ関係まとめ_ポータル.html"
