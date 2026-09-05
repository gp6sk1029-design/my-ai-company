---
description: 契約利用枠だけでCodexに質問する
---

質問: $ARGUMENTS

CLAUDE.md「AI相互連携の課金制限」に従う。
`python3 tools/subscription_ai.py codex ask` の標準入力へ質問を渡す。
質問をシェルのコマンド文字列に展開せず、プロセスの標準入力として渡すこと。
直接のCLI・APIキー利用・別経路での再試行は禁止。失敗したら停止して報告する。
成功したら回答を検証し、要点・自分の見解・結論を日本語で報告する。
