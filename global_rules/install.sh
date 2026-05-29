#!/usr/bin/env bash
# ~/.claude/CLAUDE.md に社内AI開発ルールをインストール／同期する
#
# 使い方:
#   bash global_rules/install.sh          # リポジトリの内容を ~/.claude/CLAUDE.md に適用
#   bash global_rules/install.sh --check  # 差分確認のみ（変更しない）
#
# 安全対策:
#   - 既存の ~/.claude/CLAUDE.md は .bak_YYYYMMDD でバックアップ
#   - 内容が完全一致なら何もしない
#   - --check 指定時は差分のみ表示

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$SCRIPT_DIR/CLAUDE_global.md"
TARGET_DIR="$HOME/.claude"
TARGET="$TARGET_DIR/CLAUDE.md"
CHECK_ONLY=false

# オプション解析
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=true ;;
    --help|-h)
      grep -E "^#" "$0" | head -20
      exit 0
      ;;
  esac
done

# ソース確認
if [ ! -f "$SOURCE" ]; then
  echo "❌ ソースファイルが見つかりません: $SOURCE" >&2
  exit 1
fi

# ターゲットディレクトリ作成
mkdir -p "$TARGET_DIR"

# ターゲットが存在しない場合
if [ ! -f "$TARGET" ]; then
  if $CHECK_ONLY; then
    echo "📝 [check] ~/.claude/CLAUDE.md は未作成。install実行でコピーされます。"
    exit 0
  fi
  cp "$SOURCE" "$TARGET"
  echo "✅ 新規作成: $TARGET"
  exit 0
fi

# 差分チェック
if cmp -s "$SOURCE" "$TARGET"; then
  echo "✅ 既に最新です。変更なし。"
  exit 0
fi

# --check モードなら差分表示のみ
if $CHECK_ONLY; then
  echo "📝 [check] 差分あり:"
  diff "$TARGET" "$SOURCE" || true
  echo ""
  echo "→ 適用するには: bash global_rules/install.sh"
  exit 0
fi

# バックアップして上書き
BACKUP="$TARGET.bak_$(date +%Y%m%d_%H%M%S)"
cp "$TARGET" "$BACKUP"
cp "$SOURCE" "$TARGET"
echo "✅ 更新完了: $TARGET"
echo "📦 バックアップ: $BACKUP"
