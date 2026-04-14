#!/bin/bash
# メルカリ出品管理アプリ - ワンクリック起動
# 使い方: ./ec/start.sh

cd "$(dirname "$0")/.."
export PATH="$HOME/bin:$PATH"

# 既存プロセスを停止
pkill -f web_server.py 2>/dev/null
pkill -f cloudflared 2>/dev/null
sleep 1

# サーバー起動
python3 ec/scripts/web_server.py &
sleep 2

# Cloudflareトンネル起動
cloudflared tunnel --url http://localhost:8080 > /tmp/tunnel_log.txt 2>&1 &
sleep 8

# URLを取得
URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/tunnel_log.txt | head -1)

if [ -z "$URL" ]; then
  echo ""
  echo "❌ トンネル接続に失敗しました"
  echo "   ローカルアクセス: http://localhost:8080"
  exit 1
fi

# URLをファイルに保存
echo "$URL" > ec/current_url.txt

echo ""
echo "=================================================="
echo ""
echo "  📦 メルカリ出品管理アプリ"
echo ""
echo "  🌐 $URL"
echo ""
echo "  ↑ PC・スマホどこからでもこのURL1つでOK"
echo ""
echo "=================================================="
echo ""
echo "  停止するには Ctrl+C"
echo ""

# トンネル維持（Ctrl+Cで停止）
wait
