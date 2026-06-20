#!/bin/bash
# ============================================================
#  Claude × Codex 壁打ち（生ストリーム・ダブルクリック起動）
#  正本: my-ai-company/tools/Codex壁打ち.command
#  デスクトップから消えたら、ここからコピーして復元
# ============================================================
CODEX="/Applications/Codex.app/Contents/Resources/codex"
CLAUDE="/Users/shoheikoda/.local/bin/claude"
cd "/Users/shoheikoda/Documents/my-ai-company" 2>/dev/null || true

echo "================================================"
echo "  🥊 Claude × Codex 壁打ち（生ストリーム）"
echo "================================================"
echo "※ 1往復ごとに Codex と Claude を1回ずつ呼びます（利用枠を消費）。"
echo ""

read -r -p "お題を入力: " TOPIC
[ -z "$TOPIC" ] && { echo "お題が空です。終了します。"; exit 0; }
read -r -p "往復回数（1〜5、既定2）: " ROUNDS
[ -z "$ROUNDS" ] && ROUNDS=2
case "$ROUNDS" in *[!0-9]*) ROUNDS=2;; esac
[ "$ROUNDS" -lt 1 ] && ROUNDS=1
[ "$ROUNDS" -gt 5 ] && { ROUNDS=5; echo "（安全上限5往復に切り詰めました）"; }

WORK="$(mktemp -d)"; TRANS="$WORK/t.txt"; ANS="$WORK/a.txt"; P="$WORK/p.txt"
printf 'お題: %s\n' "$TOPIC" > "$TRANS"

for i in $(seq 1 "$ROUNDS"); do
  echo ""
  echo "──────── 🟠 Codex 第${i}ラウンド ────────"
  { echo "あなたは専門家として議論に参加します。賛否・根拠・相手の見落としを簡潔に述べてください（コードは書かず助言のみ）。"; echo ""; cat "$TRANS"; } > "$P"
  if ! "$CODEX" exec -c model_reasoning_effort="low" -o "$ANS" - < "$P"; then
    echo "⚠️ Codex呼び出しに失敗しました。中断します。"; break
  fi
  echo ""
  printf '\n[Codex 第%s]: %s\n' "$i" "$(cat "$ANS" 2>/dev/null)" >> "$TRANS"

  echo ""
  echo "──────── 🔵 Claude 第${i}ラウンド ────────"
  { echo "あなたは司令塔です。直前のCodexの意見に反論・深掘りし、新しい論点を1つ足してください。簡潔に。馴れ合いにせず必ず検証する。"; echo ""; cat "$TRANS"; } > "$P"
  CLAUDE_OUT="$("$CLAUDE" -p < "$P")"
  echo "$CLAUDE_OUT"
  printf '\n[Claude 第%s]: %s\n' "$i" "$CLAUDE_OUT" >> "$TRANS"
done

echo ""
echo "──────── 🎯 結論（Claude） ────────"
{ echo "以下の壁打ち全体を踏まえ、①合意できた点 ②対立が残った点 ③最終判断 ④次の一手（1つ）を簡潔にまとめてください。"; echo ""; cat "$TRANS"; } > "$P"
"$CLAUDE" -p < "$P"

echo ""
echo "================================================"
echo "  完了。ウィンドウは閉じてOKです。"
rm -rf "$WORK"
