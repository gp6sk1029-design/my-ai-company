#!/usr/bin/env python3
"""
セッション引き継ぎ書 自動生成ツール

現在のClaude Codeセッションを分析し、新セッションで作業再開するための
「引き継ぎ書」を handover/ フォルダに生成する。

使い方：
  # 現セッションから自動生成（推奨）
  python3 tools/handover.py

  # タイトルを指定して生成
  python3 tools/handover.py --title "blog記事3執筆"

  # 直近のN個のユーザー入力だけ含める（デフォルト10）
  python3 tools/handover.py --recent 5

生成される引き継ぎ書の内容：
  - セッション概要（容量・画像数・ターン数）
  - 直近のユーザー指示（最後のN個）
  - 変更されたファイル（直近3時間以内）
  - 復帰用プロンプト（コピペ用）
  - 関連ファイル一覧
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
HANDOVER_DIR = PROJECT_ROOT / "handover"

# session_health から関数を流用
sys.path.insert(0, str(Path(__file__).resolve().parent))
from session_health import find_current_session, analyze_session, evaluate  # noqa: E402


def extract_user_messages(jsonl_path: Path, recent: int = 10) -> list[str]:
    """直近N個の「実際のユーザー入力」を抽出（tool_resultは除外）。"""
    messages = []
    with open(jsonl_path, encoding="utf-8") as f:
        for line in f:
            try:
                d = json.loads(line)
            except Exception:
                continue
            msg = d.get("message", d)
            if msg.get("role") != "user":
                continue
            content = msg.get("content")
            text = _extract_text(content)
            if text and not text.startswith("<"):  # system-reminder等は除外
                messages.append(text)
    return messages[-recent:] if recent else messages


def _extract_text(content) -> str:
    """contentからユーザーテキストだけを抽出。"""
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ""
    parts = []
    for item in content:
        if isinstance(item, dict):
            t = item.get("type")
            if t == "text":
                parts.append(item.get("text", "").strip())
            elif t == "tool_result":
                return ""  # tool_resultは除外
    return "\n".join(p for p in parts if p)


def get_recent_modified_files(hours: int = 3) -> list[Path]:
    """直近N時間以内に変更されたファイル一覧（プロジェクト内）。"""
    cutoff = datetime.now() - timedelta(hours=hours)
    cutoff_ts = cutoff.timestamp()
    files = []
    skip_dirs = {".git", "node_modules", "__pycache__", ".claude", "handover"}
    skip_exts = {".pyc", ".pickle", ".db", ".log"}

    for path in PROJECT_ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in skip_dirs for part in path.parts):
            continue
        if path.suffix in skip_exts:
            continue
        try:
            if path.stat().st_mtime > cutoff_ts:
                files.append(path)
        except OSError:
            pass
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return files[:30]  # 最大30件


def get_recent_git_log(limit: int = 5) -> list[str]:
    """直近のgitコミット一覧。"""
    try:
        result = subprocess.run(
            ["git", "log", f"-{limit}", "--oneline", "--no-decorate"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip().split("\n")
    except Exception:
        pass
    return []


def infer_topic(user_messages: list[str]) -> str:
    """直近メッセージからトピックを推定（タイトル候補）。"""
    if not user_messages:
        return "untitled"
    # 最初の長めのメッセージから推定
    for msg in user_messages:
        if 5 < len(msg) < 80:
            # 記号を除去してファイル名に使える形に
            cleaned = re.sub(r"[^\w\sぁ-んァ-ヴー一-龯a-zA-Z0-9]", "", msg)
            cleaned = re.sub(r"\s+", "-", cleaned.strip())[:30]
            if cleaned:
                return cleaned
    return "session"


def generate_handover(title: str | None = None, recent: int = 10) -> Path:
    """引き継ぎ書を生成し、保存先パスを返す。"""
    HANDOVER_DIR.mkdir(exist_ok=True)

    jsonl = find_current_session()
    if not jsonl:
        raise RuntimeError("セッションファイルが見つかりません")

    metrics = analyze_session(jsonl)
    evaluation = evaluate(metrics)
    user_messages = extract_user_messages(jsonl, recent=recent)
    modified_files = get_recent_modified_files(hours=3)
    git_log = get_recent_git_log(limit=5)

    # トピック推定
    if not title:
        title = infer_topic(user_messages)

    timestamp = datetime.now().strftime("%Y-%m-%d-%H%M")
    filename = f"{timestamp}-{title}.md"
    output_path = HANDOVER_DIR / filename

    # markdown生成
    lines = [
        f"# 引き継ぎ書 - {timestamp}",
        "",
        f"- **トピック**: {title}",
        f"- **セッションID**: `{jsonl.stem}`",
        f"- **健康状態**: {evaluation['overall']}",
        f"- **規模**: {metrics['size_mb']}MB / 画像{metrics['image_count']}枚 / ユーザー入力{metrics['user_turns']}回",
        "",
        "---",
        "",
        "## 直近のユーザー指示（古い順）",
        "",
    ]
    for i, msg in enumerate(user_messages, 1):
        # 長すぎるメッセージは要約
        preview = msg if len(msg) < 300 else msg[:280] + "..."
        # markdown内のコードブロックを壊さないようインデント
        preview_safe = preview.replace("\n", "\n   ")
        lines.append(f"{i}. {preview_safe}")
        lines.append("")

    lines.extend([
        "---",
        "",
        "## 直近3時間以内に変更されたファイル",
        "",
    ])
    if modified_files:
        for f in modified_files:
            rel = f.relative_to(PROJECT_ROOT)
            mtime = datetime.fromtimestamp(f.stat().st_mtime).strftime("%H:%M")
            lines.append(f"- `{rel}`  ({mtime})")
    else:
        lines.append("（なし）")
    lines.append("")

    lines.extend([
        "---",
        "",
        "## 直近のGitコミット",
        "",
        "```",
    ])
    if git_log:
        lines.extend(git_log)
    else:
        lines.append("（取得失敗）")
    lines.extend(["```", ""])

    lines.extend([
        "---",
        "",
        "## 🚀 復帰用プロンプト（新セッションでコピペ）",
        "",
        "```",
        f"前セッションの引き継ぎを行います。以下のファイルを必ず読んでから作業を再開してください。",
        f"",
        f"1. handover/{filename}  ← 引き継ぎ書（必読）",
        f"2. blog/SKILL.md または ec/SKILL.md ← 部門ルール",
        f"3. blog/MEMORY.md または ec/MEMORY.md ← 過去の学び",
        f"",
        f"引き継ぎ書「直近のユーザー指示」の続きから作業を再開してください。",
        f"不明点があれば質問してから着手してください。",
        "```",
        "",
        "---",
        "",
        "## 関連リソース",
        "",
        "- ルール: `CLAUDE.md` / `blog/SKILL.md` / `ec/SKILL.md`",
        "- 学習: `blog/MEMORY.md` / `ec/MEMORY.md`",
        "- 記事台帳: `blog/MEMORY.md`「記事台帳」",
        "- 記事検索: `python3 blog/scripts/article_status.py <キーワード>`",
        "",
    ])

    output_path.write_text("\n".join(lines), encoding="utf-8")
    return output_path


def main() -> int:
    parser = argparse.ArgumentParser(description="セッション引き継ぎ書の自動生成")
    parser.add_argument("--title", help="引き継ぎ書のタイトル（未指定時は自動推定）")
    parser.add_argument("--recent", type=int, default=10,
                        help="含めるユーザー入力の数（デフォルト10）")
    args = parser.parse_args()

    try:
        path = generate_handover(title=args.title, recent=args.recent)
    except Exception as e:
        print(f"❌ 引き継ぎ書生成失敗: {e}", file=sys.stderr)
        return 1

    print(f"✅ 引き継ぎ書を生成しました")
    print(f"   📄 {path}")
    print()
    print(f"💡 次のセッションで以下を実行：")
    print(f"   1. 新しいセッション（チャット）を開く")
    print(f"   2. 引き継ぎ書（{path.name}）の「復帰用プロンプト」をコピペ")
    print(f"   3. 作業再開")
    return 0


if __name__ == "__main__":
    sys.exit(main())
