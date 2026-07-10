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


# セッション役割カタログ（CLAUDE.md と一致させること）
SESSION_ROLES = {
    "pdm": {
        "name": "総合PdM（CPO）セッション",
        "scope": "全体ルール作成・部門横断調整・整合性チェック・戦略的意思決定",
        "files": ["CLAUDE.md", "global_rules/CLAUDE_global.md"],
        "keywords": ["ルール", "全社", "戦略", "PdM", "CPO", "整合", "監査"],
        "out_of_scope": "個別記事執筆・出品作業・コーディング詳細",
    },
    "blog": {
        "name": "ブログ執筆セッション",
        "scope": "記事の企画・執筆・校正・WP投稿・SNS連携",
        "files": ["blog/SKILL.md", "blog/MEMORY.md"],
        "keywords": ["記事", "ブログ", "WordPress", "JIN:R", "執筆", "校正", "ファクト"],
        "out_of_scope": "EC出品・ツール開発・全社ルール変更",
    },
    "ec": {
        "name": "EC物販セッション",
        "scope": "メルカリ出品・価格調整・在庫管理・顧客対応",
        "files": ["tools/ec/SKILL.md", "tools/ec/MEMORY.md"],
        "keywords": ["メルカリ", "出品", "価格", "在庫", "EC", "物販", "送料"],
        "out_of_scope": "ブログ執筆・ツール開発",
    },
    "tools": {
        "name": "ツール開発セッション",
        "scope": "PWA・自動化スクリプト・社内ツールの開発と改善",
        "files": ["tools/SKILL.md", "tools/MEMORY.md"],
        "keywords": ["PWA", "ツール", "スクリプト", "開発", "自動化", "Cloudflare"],
        "out_of_scope": "記事執筆・出品作業",
    },
    "sns": {
        "name": "SNS統括セッション",
        "scope": "X/Instagram/YouTube投稿・ハブ&スポーク戦略",
        "files": ["sns/SKILL.md", "sns/MEMORY.md"],
        "keywords": ["SNS", "X", "Instagram", "YouTube", "投稿", "ハッシュタグ"],
        "out_of_scope": "記事本文執筆・出品作業",
    },
    "research": {
        "name": "リサーチセッション",
        "scope": "リベシティ等の副業ネタ収集・掛け合わせ創造・自動化案件抽出・学長メソッド研究（リベ日課）",
        "files": ["research/SKILL.md", "research/MEMORY.md"],
        "keywords": ["リベ", "リベシティ", "ノウハウ図書館", "副業ネタ", "学長", "高配当株", "リベ日課", "research", "掛け合わせ"],
        "out_of_scope": "記事本文執筆・出品作業・ツール実装（提案はtoolsへ送出）・全社ルール変更",
    },
    "infra": {
        "name": "インフラ・全体管理セッション",
        "scope": "hooks・global_rules・session_health・handover等の社内基盤",
        "files": ["CLAUDE.md", ".claude/settings.json", "global_rules/CLAUDE_global.md"],
        "keywords": ["hook", "settings", "infra", "global_rules", "session_health"],
        "out_of_scope": "記事執筆・出品作業・SNS投稿",
    },
    "work": {
        "name": "生産技術主任補佐PDM（本業ツール）セッション",
        "scope": "本業ツール群の調査・修理・開発（plc-debugger／email-assistant／media-transcriber／winding-report／drawing-checker／fp7-diff）。対象リポジトリは work-projects（my-ai-companyとは別リポジトリ）",
        "files": ["../work-projects/CLAUDE.md", "../work-projects/MEMORY.md", "../work-projects/<対象ツール>/SKILL.md（あれば）"],
        "keywords": ["plc", "本業", "work-projects", "メール秘書", "文字起こし", "巻線", "図面", "検図", "fp7", "smc2"],
        "out_of_scope": "副業リポジトリ（my-ai-company）の編集（引き継ぎ書生成と各MEMORY.mdへのTODO追記のみ可）・記事執筆・SNS投稿・出品作業",
    },
}


def detect_session_role(modified_files: list[Path], user_messages: list[str]) -> str:
    """直近の活動から最も適切なセッション役割を推定。"""
    score = {key: 0 for key in SESSION_ROLES}

    # ファイル変更からスコアリング
    for f in modified_files:
        path_str = str(f).lower()
        if "blog/" in path_str or "/articles/" in path_str:
            score["blog"] += 2
        if "tools/ec/" in path_str:
            score["ec"] += 2
        if "tools/" in path_str and "tools/ec/" not in path_str:
            score["tools"] += 1
        if "sns/" in path_str:
            score["sns"] += 2
        if "research/" in path_str:
            score["research"] += 2
        if any(p in path_str for p in [".claude/", "global_rules/", "tools/handover", "tools/session_health"]):
            score["infra"] += 1
        if "work-projects" in path_str:
            score["work"] += 2
        if any(p in path_str for p in ["claude.md", "memory.md"]) and "blog/" not in path_str and "research/" not in path_str:
            score["pdm"] += 1

    # ユーザーメッセージのキーワードからスコアリング
    text = " ".join(user_messages).lower()
    for key, info in SESSION_ROLES.items():
        for kw in info["keywords"]:
            if kw.lower() in text:
                score[key] += 1

    # 最高スコアの役割を返す。同点ならpdm優先
    best = max(score.items(), key=lambda x: (x[1], x[0] == "pdm"))
    return best[0] if best[1] > 0 else "pdm"


def generate_role_prompt(role: str, handover_filename: str) -> str:
    """新セッション貼り付け用の役割定義プロンプトを生成。

    CLAUDE.md / SKILL.md / MEMORY.md に既にある内容は省く（最小プロンプト）。
    含めるのは：役割名・スコープ・読むべき固有ファイルのみ。
    """
    info = SESSION_ROLES[role]
    files_list = "\n".join(f"- {f}" for f in info["files"])

    return f"""あなたは「{info['name']}」として動作してください。

担当: {info['scope']}
スコープ外: {info['out_of_scope']}

このセッション固有の参照ファイル：
{files_list}
- handover/{handover_filename}（前セッションからの引き継ぎ）

🎭 このセッションの役割キーは `{role}` です。
このセッションで引き継ぎ書を作るときは、役割の推測に頼らず必ず
`python3 tools/handover.py --role {role}` と役割キーを明示して実行してください
（役割がプロンプト経由で次セッションに自動伝搬し、誤判定を防げます）。

引き継ぎ書を読んでから、「{info['name']}準備OK」と返答してください。
"""


def generate_handover(title: str | None = None, recent: int = 10,
                       role: str | None = None) -> tuple[Path, str]:
    """引き継ぎ書を生成し、(保存先パス, 貼り付け用プロンプト) を返す。"""
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

    # セッション役割推定（指定なければ自動）
    if role is None or role not in SESSION_ROLES:
        role = detect_session_role(modified_files, user_messages)
    role_info = SESSION_ROLES[role]

    timestamp = datetime.now().strftime("%Y-%m-%d-%H%M")
    filename = f"{timestamp}-{title}.md"
    output_path = HANDOVER_DIR / filename

    # 役割定義プロンプト生成
    role_prompt = generate_role_prompt(role, filename)

    # markdown生成
    lines = [
        f"# 引き継ぎ書 - {timestamp}",
        "",
        f"- **トピック**: {title}",
        f"- **推定役割**: {role_info['name']}（`{role}`）",
        f"- **セッションID**: `{jsonl.stem}`",
        f"- **健康状態**: {evaluation['overall']}",
        f"- **規模**: {metrics['size_mb']}MB / 画像{metrics['image_count']}枚 / ユーザー入力{metrics['user_turns']}回",
        "",
        "---",
        "",
        "## 🎭 新セッション貼り付け用プロンプト（役割定義）",
        "",
        "**新セッションを開いて、最初に以下を貼り付けてください：**",
        "",
        "```",
        role_prompt.strip(),
        "```",
        "",
        "> 役割が違う場合は `python3 tools/handover.py --role <pdm|blog|ec|tools|sns|research|infra|work>` で再生成可能",
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
        "## 🚀 シンプル復帰用プロンプト（役割定義不要時のみ）",
        "",
        "上の「役割定義プロンプト」を使うのが推奨。シンプルに復帰したい場合のみこちら：",
        "",
        "```",
        f"前セッションの引き継ぎを行います。",
        f"handover/{filename} を読み、",
        f"そこに記載の役割と引き継ぎ内容に従って作業を再開してください。",
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
    return output_path, role_prompt


def main() -> int:
    parser = argparse.ArgumentParser(description="セッション引き継ぎ書の自動生成")
    parser.add_argument("--title", help="引き継ぎ書のタイトル（未指定時は自動推定）")
    parser.add_argument("--recent", type=int, default=10,
                        help="含めるユーザー入力の数（デフォルト10）")
    parser.add_argument("--role", choices=list(SESSION_ROLES.keys()),
                        help="セッション役割（pdm/blog/ec/tools/sns/research/infra）。未指定時は自動推定")
    args = parser.parse_args()

    try:
        path, role_prompt = generate_handover(title=args.title, recent=args.recent, role=args.role)
    except Exception as e:
        print(f"❌ 引き継ぎ書生成失敗: {e}", file=sys.stderr)
        return 1

    print(f"✅ 引き継ぎ書を生成しました")
    print(f"   📄 {path}")
    print()
    print("=" * 56)
    print("📋 新しいチャットにこのまま貼り付けてください（コピペ用）")
    print("=" * 56)
    print(role_prompt.strip())
    print("=" * 56)
    print()
    print(f"💡 手順：①新しいチャットを開く ②上の枠の文をそのまま貼る ③Claudeが「準備OK」と返したら続きを依頼")
    return 0


if __name__ == "__main__":
    sys.exit(main())
