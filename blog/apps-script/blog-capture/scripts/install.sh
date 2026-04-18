#!/bin/bash
#
# install.sh - blog-capture 自動セットアップスクリプト
# ─────────────────────────────────────────────
# このスクリプトは以下を自動実行する：
#   1. Homebrew インストール（未導入なら）
#   2. Node.js インストール
#   3. clasp インストール
#   4. Python bootstrap（Drive フォルダ ID 取得・スプレッドシート作成）
#   5. clasp login（★ブラウザでの認証が必要★）
#   6. GAS プロジェクト作成・コード push
#   7. setup() 実行
#   8. Web App デプロイ
#   9. config.json に Web App URL 反映
#
# Usage:
#   cd blog/apps-script/blog-capture
#   bash scripts/install.sh

set -euo pipefail

BLOG_CAPTURE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$BLOG_CAPTURE_DIR/../../.." && pwd)"
CONFIG_JSON="$REPO_ROOT/blog/config.json"

cd "$BLOG_CAPTURE_DIR"

echo "============================================"
echo "  blog-capture 自動セットアップ"
echo "============================================"
echo ""
echo "プロジェクトディレクトリ: $BLOG_CAPTURE_DIR"
echo ""

# ─── Step 1: Homebrew ─────────────────────
if ! command -v brew &> /dev/null; then
  # Apple Silicon 用パスも確認
  if [ -f /opt/homebrew/bin/brew ]; then
    export PATH="/opt/homebrew/bin:$PATH"
    echo "✅ Homebrew 検出: /opt/homebrew/bin/brew"
  elif [ -f /usr/local/bin/brew ]; then
    export PATH="/usr/local/bin:$PATH"
    echo "✅ Homebrew 検出: /usr/local/bin/brew"
  else
    echo "[Step 1/9] 📦 Homebrew をインストールします"
    echo "  ※管理者パスワードの入力が求められます"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [ -f /opt/homebrew/bin/brew ]; then
      export PATH="/opt/homebrew/bin:$PATH"
      echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
    fi
  fi
else
  echo "[Step 1/9] ✅ Homebrew 既導入"
fi

# ─── Step 2: Node.js ─────────────────────
if ! command -v node &> /dev/null; then
  echo "[Step 2/9] 📦 Node.js をインストール"
  brew install node
else
  echo "[Step 2/9] ✅ Node.js 既導入 ($(node --version))"
fi

# ─── Step 3: clasp ─────────────────────
if ! command -v clasp &> /dev/null; then
  echo "[Step 3/9] 📦 clasp をインストール"
  npm install -g @google/clasp
else
  echo "[Step 3/9] ✅ clasp 既導入 ($(clasp --version 2>/dev/null || echo 'v?'))"
fi

# ─── Step 4: Python bootstrap ─────────────────────
echo "[Step 4/9] 🐍 Drive フォルダ ID 取得・スプレッドシート作成"
python3 "$BLOG_CAPTURE_DIR/scripts/bootstrap.py"

# ─── Step 5: clasp login ─────────────────────
if [ ! -f "$HOME/.clasprc.json" ]; then
  echo ""
  echo "[Step 5/9] 🔐 clasp login"
  echo "  ★ブラウザが開きます。Google にログインして権限を承認してください★"
  echo ""
  read -p "Enter で続行（ブラウザ認証に進みます）..." _
  clasp login
else
  echo "[Step 5/9] ✅ clasp ログイン済み"
fi

# ─── Step 6: GAS プロジェクト作成 ─────────────────────
if [ ! -f "$BLOG_CAPTURE_DIR/.clasp.json" ]; then
  echo "[Step 6/9] 🆕 GAS プロジェクトを作成"
  echo ""
  echo "  ★重要: https://script.google.com/home/usersettings で"
  echo "  「Google Apps Script API」が有効になっている必要があります"
  echo ""
  read -p "有効化済みなら Enter、未実施なら上記 URL を開いてから Enter..." _
  clasp create --title "blog-capture" --type webapp --rootDir .
else
  echo "[Step 6/9] ✅ GAS プロジェクト既存"
fi

# ─── Step 7: コード push ─────────────────────
echo "[Step 7/9] 📤 コードを push"
clasp push -f

# ─── Step 8: setup() 実行 ─────────────────────
echo "[Step 8/9] ⚙️ setup() を実行（初回は権限承認が必要）"
echo ""
echo "  ★エディタが開きます。手動で以下を実行してください：★"
echo "    1. 関数ドロップダウンから 'setup' を選択"
echo "    2. ▶ 実行ボタンをクリック"
echo "    3. 権限の承認（Drive/Sheets）"
echo "    4. ドロップダウンから 'runTest' を選択し ▶ 実行"
echo "    5. 実行ログで既存記事フォルダが取得できているか確認"
echo ""
read -p "上記を実行完了したら Enter..." _
clasp open

echo ""
read -p "ブラウザで setup() と runTest() 完了したら Enter..." _

# ─── Step 9: Deploy ─────────────────────
echo "[Step 9/9] 🚀 Web App デプロイ"
DEPLOY_OUTPUT=$(clasp deploy --description "v1" 2>&1)
echo "$DEPLOY_OUTPUT"
# Deploy IDを取得
DEPLOY_ID=$(echo "$DEPLOY_OUTPUT" | grep -oE 'AKfycb[a-zA-Z0-9_-]+' | head -1 || echo '')
if [ -z "$DEPLOY_ID" ]; then
  echo "⚠️ Deploy ID を自動取得できませんでした。手動で Web App URL を config.json に記入してください"
else
  WEB_APP_URL="https://script.google.com/macros/s/$DEPLOY_ID/exec"
  echo ""
  echo "✅ Web App URL: $WEB_APP_URL"
  # config.json を更新
  python3 -c "
import json
from pathlib import Path
p = Path('$CONFIG_JSON')
d = json.loads(p.read_text(encoding='utf-8'))
d.setdefault('material_uploader', {})['gas_web_app_url'] = '$WEB_APP_URL'
p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding='utf-8')
print('✅ config.json に Web App URL を記録しました')
"
fi

echo ""
echo "============================================"
echo "  🎉 セットアップ完了！"
echo "============================================"
echo ""
echo "次のステップ："
echo "  1. スマホ（iPhone Safari / Android Chrome）で以下 URL を開く:"
echo "     $WEB_APP_URL"
echo "  2. 「ホーム画面に追加」"
echo "  3. ホーム画面のアイコンから起動"
echo ""
echo "使い方は blog/apps-script/blog-capture/README.md 参照"
