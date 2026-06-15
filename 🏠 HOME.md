---
title: my-ai-company ホーム
updated: 2026-06-16
tags: [moc, home]
aliases:
  - HOME
  - ホーム
  - 目次
---

# 🏠 my-ai-company（専用AI会社）ホーム

> このノートはObsidianの入口（地図）です。リンクをクリックして各所へ飛べます。
> ⚠️ 知識の正本はあくまで下記の各ファイル。このHOMEは"目次"であり、ここに中身は書きません。

## 📜 全社の正本ルール
- [[CLAUDE]] … 全社ルール（5部門体制・AI操作方針・データ蓄積ルール）の正本。**まずここ**
- [[AGENTS]] … Codex向けの案内（中身はCLAUDE.mdへ誘導）
- [[グローバル共通ルール]] … global_rules/CLAUDE_global.md
- [[外部脳の使い方]] … 外部脳の読み書き規律（CLAUDE.mdの要約・Claude/Codex共通）

## 🏢 5部門（各部門は SKILL=手順 / MEMORY=学び の2本立て）

| 部門 | 手順（SKILL） | 学び・データ（MEMORY） |
|---|---|---|
| ブログ | [[ブログ手順]] | [[記事台帳]] |
| ツール作成 | [[ツール手順]] | [[ツール学び]] |
| SNS | [[SNS手順]] | [[SNS学び]] |
| リサーチ | [[リサーチ手順]] | [[リサーチ学び]] |
| PDM（統括） | [[CLAUDE]] | reports/・handover/ |

### ツール部門の個別ツール
- メルカリEC：[[EC手順]] / [[EC学び]]
- 献立くん：[[献立くん手順]] / [[献立くん学び]]
- ライフプランくん：[[ライフプラン手順]] / [[ライフプラン学び]]

### リサーチ部門のスキル群
- [[収集ルール]]（collect）／[[掛け合わせ]]（synthesize）／[[自動化提案]]（automate）／[[学長メソッド]]（digest）／[[他部門連携]]（handoff）

### SNSチャネル別
- [[X手順]]（旧Twitter）／[[Instagram手順]]／[[YouTube手順]]／[[SNSカレンダー]]

## 🔁 セッション運営
- [[引き継ぎルール]] … handover/ の運用ルール（README）
- `tools/handover.py` … 引き継ぎ書を生成（`--role` 必須）
- `tools/session_health.py` … 容量診断（実コンテキスト方式）
- `reports/` … 全社監査・月次サマリー等の成果物

## 🤖 AIツールの分担
- **Claude Code**：このAI会社の運営・知識管理・各部門作業
- **Codex**（gpt-5.5）：同じリポジトリを共有。AGENTS.md→CLAUDE.md のルールに従う
- 🔴 **ClaudeとCodexは同時刻に同じ作業で並走させない**（順番に使う）。開始時 `git pull`・終了時の競合検査で逐次運用なら安全

## 📂 知識はどこに置くか（外部脳の地図）
- 作業の**手順・ルール** → 各 `SKILL.md`
- **学び・実績・失敗パターン** → 各 `MEMORY.md`
- **一度きりの成果物**（監査・レポート） → `reports/`
- **次セッションへの申し送り** → `handover/`
- 機密・個人情報・生データ → コミットしない（`.gitignore` 参照）
