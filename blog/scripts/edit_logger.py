#!/usr/bin/env python3
"""
記事修正ログ記録ツール（修正からの学習システム）

記事mdを修正したら呼ぶ。`blog/edits/_log.md` に1行追記し、
直近の git diff 要約を添える。同じ種別タグが過去にあれば
「N回目。MEMORY/SKILLへ昇格を検討」と警告する（CLAUDE.md「2回で昇格」トリガーの機械検知）。

使い方:
  python3 blog/scripts/edit_logger.py \
    --slug switchbot-lock-lite-review \
    --reason "電池が単3との誤記。CR123Aは固有形状で2本使用" \
    --learning "AIモデル名・製品仕様は書く直前に公式で再確認する" \
    --tag 事実誤り

  # 修正要約を明示したいとき
  python3 blog/scripts/edit_logger.py --slug X --summary "年60時間→年5時間" \
    --reason "..." --learning "..." --tag 数値裏取り

標準ライブラリのみ。
"""
from __future__ import annotations
import argparse
import datetime
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
LOG = ROOT / "blog" / "edits" / "_log.md"
ARTICLES_DIR = ROOT / "blog" / "articles"


def git_diff_summary(slug: str) -> str:
    """直近の git diff（未コミット＋HEAD差分）から +/- 行数を要約。"""
    md_rel = f"blog/articles/{slug}.md"
    try:
        # 未コミットの変更
        out = subprocess.run(
            ["git", "diff", "--numstat", "--", md_rel],
            cwd=str(ROOT), capture_output=True, text=True, timeout=15
        ).stdout.strip()
        if not out:
            # 直近コミットの差分
            out = subprocess.run(
                ["git", "diff", "--numstat", "HEAD~1", "HEAD", "--", md_rel],
                cwd=str(ROOT), capture_output=True, text=True, timeout=15
            ).stdout.strip()
        if out:
            parts = out.split("\t")
            if len(parts) >= 2:
                return f"+{parts[0]}/-{parts[1]}行"
    except Exception:
        pass
    return "(diff取得不可)"


def count_tag(tag: str) -> int:
    """_log.md 内で同じ種別タグが過去に何回出たか数える。"""
    if not LOG.exists():
        return 0
    n = 0
    for line in LOG.read_text(encoding="utf-8").split("\n"):
        if not line.startswith("|") or line.startswith("| 日付") or "---" in line:
            continue
        cells = [c.strip() for c in line.split("|")]
        # cells: ['', 日付, slug, 要約, 理由, 学び, タグ, 昇格状態, '']
        if len(cells) >= 8 and cells[6] == tag:
            n += 1
    return n


def esc(text: str) -> str:
    """テーブルセル用に | をエスケープ、改行を除去。"""
    return (text or "").replace("|", "\\|").replace("\n", " ").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", required=True, help="記事slug（blog/articles/{slug}.md）")
    ap.add_argument("--reason", required=True, help="修正した理由")
    ap.add_argument("--learning", required=True, help="次に活かす学び")
    ap.add_argument("--tag", required=True, help="種別タグ（装飾/数値裏取り/事実誤り/文体/画像/SEO/構成 等）")
    ap.add_argument("--summary", default="", help="修正要約（前→後）。省略時はgit diff行数")
    args = ap.parse_args()

    md = ARTICLES_DIR / f"{args.slug}.md"
    if not md.exists():
        print(f"⚠️ 警告: {md} が見つかりません（slug違い?）。ログは記録します。", file=sys.stderr)

    today = datetime.date.today().isoformat()
    summary = args.summary or git_diff_summary(args.slug)
    prior = count_tag(args.tag)

    row = f"| {today} | {esc(args.slug)} | {esc(summary)} | {esc(args.reason)} | {esc(args.learning)} | {esc(args.tag)} | 生ログ |"

    # 追記
    LOG.parent.mkdir(parents=True, exist_ok=True)
    if not LOG.exists():
        LOG.write_text(
            "# 記事修正ログ（個別の生ログ）\n\n"
            "| 日付 | 記事slug | 修正要約(前→後) | 理由 | 学び | 種別タグ | 昇格状態 |\n"
            "|---|---|---|---|---|---|---|\n",
            encoding="utf-8"
        )
    with LOG.open("a", encoding="utf-8") as f:
        f.write(row + "\n")

    print(f"✅ 修正ログを記録しました: {LOG}")
    print(f"   {row}")

    # 昇格トリガー警告（CLAUDE.md「同じ失敗が2回以上→昇格」）
    total = prior + 1
    if total >= 2:
        print()
        print(f"⚠️  種別タグ「{args.tag}」は これで {total} 回目です。")
        print(f"    → CLAUDE.md「進化のトリガー」に従い、昇格を検討してください：")
        print(f"      1. blog/MEMORY.md「失敗パターン」表 or「進化ログ」へパターン化")
        print(f"      2. 繰り返す本質的ミスなら ~/.claude/projects/.../memory/feedback_blog.md へ")
        print(f"      3. 昇格したら _log.md の該当行の「昇格状態」を『済(MEMORY)』等に更新")


if __name__ == "__main__":
    main()
