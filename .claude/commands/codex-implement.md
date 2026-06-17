---
description: 小さな実装タスクをCodexに下請けさせ、Claudeが必ず差分を確認してから統合する
allowed-tools: Bash(/Applications/Codex.app/Contents/Resources/codex exec*), Bash(git diff*), Bash(git status*)
---

あなたは司令塔です。明確で小さな実装タスクを専門家Codex（gpt-5.5）に下請けさせます。**Codexの出力は無検証で採用しない**——必ずあなたが差分を確認・検証してからユーザーに提示する。

実装タスク: $ARGUMENTS

## 手順
1. まずタスクが「Codexに任せてよい小さく明確なもの」か判断する。曖昧・大規模・破壊的なら、Codexに投げず「これは分割が必要」とユーザーに返す。
2. 下請け実行（Codexが作業ツリーに変更を加える場合がある）:
!`/Applications/Codex.app/Contents/Resources/codex exec -c model_reasoning_effort="low" "次のタスクを実装してください。スコープを厳守し、関係ないファイルは触らないこと: $ARGUMENTS"`

<!-- コスト最小化：推論low既定（モデルはgpt-5.5のまま）。難度の高い実装はClaudeが `-c model_reasoning_effort="high"` に上げてよい。 -->

3. Codexが変更を加えたか確認:
!`git status --short`
4. 変更があれば差分を読む:
!`git diff`

## あなた（Claude）の仕事
- Codexが作った差分を**1行ずつレビュー**し、CLAUDE.mdのルール（APIキー直書き禁止・固定構成・命名等）に違反がないか検証
- 問題があれば修正、または `git checkout -- <file>` で破棄して理由を説明
- 最終的に「Codexがやったこと／あなたが検証・修正した点／このまま採用してよいか」を日本語でユーザーに報告

⚠️ Codexの実装はレビュー前提。検証せずに「できました」と言わない。
