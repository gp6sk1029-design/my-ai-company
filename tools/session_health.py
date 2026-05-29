#!/usr/bin/env python3
"""
セッション容量・健康診断ツール

現在のClaude Codeセッション（jsonl）を分析し、容量・画像数・ターン数の
健康状態をチェックする。Stop hookから呼ばれて、警告閾値を超えたときだけ
画面に出力する。

使い方：
  # 自動検出した最新セッションを診断
  python3 tools/session_health.py

  # 静かモード（OK時は何も出さない、警告時のみ出力）— Stop hook向け
  python3 tools/session_health.py --quiet

  # JSON出力
  python3 tools/session_health.py --json

  # 特定セッションを指定
  python3 tools/session_health.py --session /path/to/xxxxx.jsonl

検出ロジック：
  画像数:  WARN=25,  CRIT=40
  サイズ:  WARN=5MB, CRIT=9MB
  ターン:  WARN=30,  CRIT=50  （実コード・CLAUDE.mdと一致。ユーザー入力回数ベース）
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent  # my-ai-company/

# 閾値
THRESHOLDS = {
    "images": {"warn": 25, "crit": 40},
    "size_mb": {"warn": 5, "crit": 9},
    "turns": {"warn": 30, "crit": 50},  # ユーザー入力回数ベース
}


def find_current_session() -> Path | None:
    """現プロジェクトの最新セッションjsonlを推定。"""
    # ~/.claude/projects/<encoded-path>/*.jsonl
    cwd = Path.cwd().resolve()
    encoded = "-" + str(cwd).replace("/", "-").lstrip("-")
    base = Path.home() / ".claude" / "projects" / encoded
    if not base.exists():
        # プロジェクトルートでも試す
        encoded = "-" + str(PROJECT_ROOT).replace("/", "-").lstrip("-")
        base = Path.home() / ".claude" / "projects" / encoded
        if not base.exists():
            return None

    sessions = sorted(
        base.glob("*.jsonl"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return sessions[0] if sessions else None


def _is_real_user_message(content) -> bool:
    """tool_result ではない、ユーザーが実際に入力したメッセージか判定。"""
    if isinstance(content, str):
        return True
    if not isinstance(content, list):
        return False
    for item in content:
        if isinstance(item, dict):
            t = item.get("type")
            # tool_result や system-reminder はカウント外
            if t == "tool_result":
                return False
            if t in ("text", "image"):
                return True
    return False


def analyze_session(jsonl_path: Path) -> dict:
    """セッションjsonlを解析して指標を返す。"""
    image_count = 0
    user_turns = 0  # ユーザーが実際に発言したターン
    assistant_turns = 0  # アシスタントの応答（複数tool_useがあっても1とカウント）
    file_size = jsonl_path.stat().st_size

    def walk_for_images(obj):
        nonlocal image_count
        if isinstance(obj, dict):
            if obj.get("type") == "image":
                image_count += 1
            for v in obj.values():
                walk_for_images(v)
        elif isinstance(obj, list):
            for item in obj:
                walk_for_images(item)

    last_assistant_id = None
    with open(jsonl_path, encoding="utf-8") as f:
        for line in f:
            try:
                d = json.loads(line)
            except Exception:
                continue
            msg = d.get("message", d)
            role = msg.get("role")
            content = msg.get("content")
            if role == "user" and _is_real_user_message(content):
                user_turns += 1
            elif role == "assistant":
                # 同一response_idのassistantメッセージは1ターンとして数える
                # response_id がない場合は uuid やtimestampで近似
                msg_id = msg.get("id") or d.get("uuid") or d.get("timestamp")
                if msg_id != last_assistant_id:
                    assistant_turns += 1
                    last_assistant_id = msg_id
            walk_for_images(msg)

    return {
        "session_file": str(jsonl_path),
        "size_bytes": file_size,
        "size_mb": round(file_size / 1024 / 1024, 2),
        "image_count": image_count,
        "user_turns": user_turns,
        "assistant_turns": assistant_turns,
        "total_turns": user_turns + assistant_turns,
    }


def evaluate(metrics: dict) -> dict:
    """指標を閾値で評価。各項目のレベル（OK/WARN/CRIT）と総合判定を返す。"""
    levels = {}
    for key, value in [
        ("images", metrics["image_count"]),
        ("size_mb", metrics["size_mb"]),
        ("turns", metrics["user_turns"]),
    ]:
        t = THRESHOLDS[key]
        if value >= t["crit"]:
            levels[key] = "CRIT"
        elif value >= t["warn"]:
            levels[key] = "WARN"
        else:
            levels[key] = "OK"

    if "CRIT" in levels.values():
        overall = "CRIT"
    elif "WARN" in levels.values():
        overall = "WARN"
    else:
        overall = "OK"

    return {"levels": levels, "overall": overall}


def format_report(metrics: dict, evaluation: dict) -> str:
    """人間向けレポート文字列を生成。"""
    overall = evaluation["overall"]
    icon = {"OK": "✅", "WARN": "⚠️ ", "CRIT": "🚨"}[overall]
    lines = [
        f"\n{icon} セッション健康診断: {overall}",
        f"   📦 サイズ : {metrics['size_mb']:>5} MB    [{evaluation['levels']['size_mb']}]"
        f"  (warn≧{THRESHOLDS['size_mb']['warn']}MB, crit≧{THRESHOLDS['size_mb']['crit']}MB)",
        f"   🖼️  画像  : {metrics['image_count']:>5} 枚    [{evaluation['levels']['images']}]"
        f"  (warn≧{THRESHOLDS['images']['warn']}枚, crit≧{THRESHOLDS['images']['crit']}枚)",
        f"   💬 ユーザー入力: {metrics['user_turns']:>3} 回    [{evaluation['levels']['turns']}]"
        f"  (warn≧{THRESHOLDS['turns']['warn']}回, crit≧{THRESHOLDS['turns']['crit']}回)",
    ]
    if overall == "WARN":
        lines.append("")
        lines.append("👉 推奨対応:")
        lines.append("   - `/compact` で会話履歴を圧縮（画像も除去）")
        lines.append("   - または『引き継ぎ準備して』と入力 → handover書を生成して新セッションへ")
    elif overall == "CRIT":
        lines.append("")
        lines.append("🚨 危険ゾーン: 即座に対応推奨")
        lines.append("   1. 『引き継ぎ準備して』と入力（tools/handover.py 起動）")
        lines.append("   2. 生成された復帰用プロンプトを新セッションに貼る")
        lines.append("   3. 現セッションは閉じる（または /compact で延命）")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="セッション健康診断")
    parser.add_argument("--quiet", action="store_true",
                        help="OK時は何も出力しない（Stop hook向け）")
    parser.add_argument("--json", action="store_true", help="JSON出力")
    parser.add_argument("--session", type=Path, help="特定セッションを指定")
    args = parser.parse_args()

    jsonl = args.session if args.session else find_current_session()
    if not jsonl or not jsonl.exists():
        if not args.quiet:
            print("⚠️  セッションファイルが見つかりません", file=sys.stderr)
        return 0  # quietモードでは終了コード0で抜ける（hookを止めない）

    metrics = analyze_session(jsonl)
    evaluation = evaluate(metrics)

    if args.json:
        print(json.dumps({**metrics, **evaluation}, ensure_ascii=False, indent=2))
        return 0

    if args.quiet and evaluation["overall"] == "OK":
        return 0  # 静かに終了

    print(format_report(metrics, evaluation))
    return 0


if __name__ == "__main__":
    sys.exit(main())
