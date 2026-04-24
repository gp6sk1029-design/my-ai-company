#!/bin/bash
# MacBookセットアップスクリプト
# 使い方: このファイルの中身をコピペする必要なし
# ターミナルで以下1行を実行するだけ:
#
#   bash <(curl -s https://raw.githubusercontent.com/gp6sk1029-design/my-ai-company/main/setup_mac.sh)
#

echo "=== my-ai-company MacBookセットアップ開始 ==="

cd ~

# バックアップ
if [ -d "my-ai-company" ]; then
  echo "既存フォルダをバックアップ中..."
  mv my-ai-company "my-ai-company-backup-$(date '+%Y%m%d-%H%M%S')"
  echo "✅ バックアップ完了"
fi

# clone
echo "GitHubからclone中..."
git clone https://github.com/gp6sk1029-design/my-ai-company

if [ $? -eq 0 ]; then
  echo ""

  # 社内AI開発ルール（グローバルCLAUDE.md）をインストール
  if [ -f ~/my-ai-company/global_rules/install.sh ]; then
    echo "=== 社内AI開発ルールを ~/.claude/CLAUDE.md に同期中 ==="
    bash ~/my-ai-company/global_rules/install.sh || true
    echo ""
  fi

  echo "=== ✅ セットアップ完了！ ==="
  echo ""
  echo "最新のコミット:"
  cd ~/my-ai-company && git log --oneline -3
  echo ""
  echo "自動sync設定: 入ってます（SessionStart時にグローバルルールも自動同期）"
  echo "次のステップ: Claude Codeで ~/my-ai-company を開くだけ"
  echo ""

  # バックアップとの差分チェック
  BACKUP_DIR=$(ls -d ~/my-ai-company-backup-* 2>/dev/null | tail -1)
  if [ -n "$BACKUP_DIR" ]; then
    echo "=== バックアップにしかないファイル ==="
    diff -rq "$BACKUP_DIR" ~/my-ai-company 2>/dev/null | grep "Only in.*backup" || echo "なし（全ファイル同期済み）"
    echo ""
  fi
else
  echo "❌ cloneに失敗しました。ネットワークかGitHub認証を確認してください"
fi
