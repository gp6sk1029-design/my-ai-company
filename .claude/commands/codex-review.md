---
description: 契約利用枠だけでCodexに未コミット変更をレビューさせる
---

CLAUDE.md「AI相互連携の課金制限」に従う。
`python3 tools/subscription_ai.py codex review` を実行する。
直接のCLI・APIキー利用・別経路での再試行は禁止。失敗したら停止して報告する。
成功したら指摘を検証し、重要度順の指摘・自分の判断・対応案を日本語で報告する。
