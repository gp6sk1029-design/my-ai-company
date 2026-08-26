#!/usr/bin/env python3
"""圧縮失敗に備えたローリング復旧チェックポイントを保存する。

Claude CodeのStop hookではstdinのtranscript_pathから直近指示を取得する。
Codexでは重要な節目に --force --role <role> --note "..." で明示更新する。
通常の引き継ぎ書と違い、役割ごとに1ファイルだけを上書きする。
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
HANDOVER_DIR = PROJECT_ROOT / "handover"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from handover import (  # noqa: E402
    SESSION_ROLES,
    detect_session_role,
    extract_user_messages,
    get_recent_git_log,
    get_recent_modified_files,
)
from session_health import analyze_session, resolve_window  # noqa: E402

SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_ -]?key|token|password|passwd|secret)\s*[:=]\s*\S+"),
    re.compile(r"\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b"),
]


def redact(text: str, limit: int = 700) -> str:
    """秘密らしい値を除去し、チェックポイントの肥大化を防ぐ。"""
    clean = text.replace("\x00", " ").strip()
    for pattern in SECRET_PATTERNS:
        clean = pattern.sub("[REDACTED]", clean)
    return clean[:limit] + ("…" if len(clean) > limit else "")


def read_hook_input() -> dict:
    if sys.stdin.isatty():
        return {}
    try:
        raw = sys.stdin.read()
        return json.loads(raw) if raw.strip() else {}
    except Exception:
        return {}


def git(*args: str) -> str:
    try:
        result = subprocess.run(
            ["git", *args], cwd=PROJECT_ROOT, capture_output=True,
            text=True, timeout=8,
        )
        return result.stdout.strip() if result.returncode == 0 else ""
    except Exception:
        return ""


def main() -> int:
    parser = argparse.ArgumentParser(description="圧縮失敗用の復旧チェックポイント生成")
    parser.add_argument("--role", choices=list(SESSION_ROLES), help="役割キー")
    parser.add_argument("--runtime", choices=("claude-code", "codex", "manual"), default="manual")
    parser.add_argument("--threshold", type=float, default=55.0, help="自動保存を始める使用率")
    parser.add_argument("--force", action="store_true", help="使用率に関係なく保存")
    parser.add_argument("--note", action="append", default=[], help="復旧時に必要な要点")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    hook = read_hook_input()
    transcript = hook.get("transcript_path") or hook.get("transcriptPath")
    transcript_path = Path(transcript).expanduser() if transcript else None
    metrics = None
    context_pct = None
    if transcript_path and transcript_path.exists():
        try:
            metrics = analyze_session(transcript_path)
            window, _ = resolve_window(metrics)
            if metrics.get("context_tokens"):
                context_pct = metrics["context_tokens"] / window * 100
        except Exception:
            metrics = None

    if not args.force and (context_pct is None or context_pct < args.threshold):
        return 0

    messages = []
    if transcript_path and transcript_path.exists():
        messages = [redact(m) for m in extract_user_messages(transcript_path, recent=6)]
    notes = [redact(n) for n in args.note if n.strip()]
    modified = get_recent_modified_files(hours=6)
    role = args.role or detect_session_role(modified, messages + notes)
    role_info = SESSION_ROLES[role]

    HANDOVER_DIR.mkdir(exist_ok=True)
    output = HANDOVER_DIR / f"RECOVERY-{role}.md"
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    branch = git("branch", "--show-current") or "不明"
    status = git("status", "--short") or "変更なし"
    logs = get_recent_git_log(limit=5)

    lines = [
        f"# 緊急復旧チェックポイント（{role}）",
        "",
        "> 自動圧縮・コンテキスト超過で元セッションを操作できない場合に読む。",
        "> 通常の正式な引き継ぎ書ではなく、役割ごとに上書きされる非常用スナップショット。",
        "",
        f"- 更新日時: {now}",
        f"- 実行環境: {args.runtime}",
        f"- 役割: {role_info['name']}（`{role}`）",
        f"- 担当: {role_info['scope']}",
        f"- Gitブランチ: `{branch}`",
    ]
    if context_pct is not None:
        lines.append(f"- 保存時コンテキスト使用率: {context_pct:.1f}%")

    lines += ["", "## 復旧時の手順", ""]
    lines += [
        "1. `CLAUDE.md` と役割固有ファイルを読む。",
        f"2. この `handover/{output.name}` を読む。",
        "3. `git status --short` と `git diff` で未完了変更を確認する。",
        "4. 下記の直近指示・作業メモと実ファイルを照合し、推測だけで続行しない。",
        "5. 情報が不足する場合だけ、ユーザーへ最後の未完了点を確認する。",
    ]

    lines += ["", "## 作業メモ", ""]
    if notes:
        lines.extend(f"- {note}" for note in notes)
    else:
        lines.append("- 明示メモなし。直近指示とGit差分から復元する。")

    lines += ["", "## 直近のユーザー指示", ""]
    if messages:
        for i, message in enumerate(messages, 1):
            lines += [f"### {i}", "", message, ""]
    else:
        lines.append("- transcriptを取得できませんでした。Codexのタスク履歴とGit差分を確認してください。")

    lines += ["", "## Git状態", "", "```text", status, "```", "", "## 最近のコミット", ""]
    lines.extend(f"- `{line}`" for line in logs if line)
    lines += ["", "## 直近6時間に更新された主なファイル", ""]
    for path in modified[:30]:
        try:
            lines.append(f"- `{path.relative_to(PROJECT_ROOT)}`")
        except ValueError:
            continue
    lines += ["", "---", "", "正常終了後、必要なら `python3 tools/handover.py --role " + role + "` で正式な引き継ぎ書を作成する。", ""]

    output.write_text("\n".join(lines), encoding="utf-8")
    if not args.quiet:
        print(f"復旧チェックポイントを更新: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
