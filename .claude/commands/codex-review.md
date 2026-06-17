---
description: 今の変更（未コミット差分）をCodexにセカンドレビューさせる
allowed-tools: Bash(/Applications/Codex.app/Contents/Resources/codex review*)
---

あなたは司令塔です。現在の未コミット変更を、専門家Codex（gpt-5.5）にセカンドオピニオンとしてレビューさせます。

## Codexのレビュー結果
!`/Applications/Codex.app/Contents/Resources/codex review --uncommitted $ARGUMENTS`

## あなた（Claude）の仕事
上のCodexのレビュー結果を読み、次の形でユーザーに日本語で報告する：
1. **Codexが指摘した点の要約**（重要度順）
2. **あなたの判断**：各指摘に同意するか/しないか、その理由（鵜呑みにしない）
3. **対応案**：直すべきもの・無視してよいもの・保留を仕分け

⚠️ Codexの指摘も絶対ではない。明らかな誤読・的外れは「これは不要」と切る。
