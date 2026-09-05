"""Read-only release preflight. Never stage, commit, or push files."""

import argparse
import ast
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SECRET = re.compile(r"(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)")
CONFLICT = re.compile(r"^(?:<<<<<<< |>>>>>>> )", re.M)


def changed_paths(root):
    paths = set()
    for args in (("diff", "--name-only", "-z", "HEAD"),
                 ("ls-files", "--others", "--exclude-standard", "-z")):
        output = subprocess.check_output(["git", *args], cwd=root)
        paths.update(p for p in output.decode("utf-8").split("\0") if p)
    return sorted(paths)


def inspect_file(path, name):
    issues = []
    if path.is_symlink():
        return [f"{name}: シンボリックリンクの送信先を手動確認"]
    if not path.exists():
        return []
    base = path.name.lower()
    if ((base.startswith(".env") and not base.endswith((".example", ".sample")))
            or base in {"auth.json", "credentials.json", ".credentials.json"}
            or path.suffix.lower() in {".pem", ".key", ".p12", ".pickle"}):
        return [f"{name}: 秘密情報の可能性があるファイル名"]
    if path.stat().st_size > 5_000_000:
        return [f"{name}: 大容量ファイルは送信前に手動確認"]
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return [f"{name}: バイナリ内容を手動確認"]
    if SECRET.search(content):
        issues.append(f"{name}: 秘密値らしい文字列を検出（値は非表示）")
    if CONFLICT.search(content):
        issues.append(f"{name}: 競合マーカー候補あり")
    try:
        if path.suffix == ".py":
            ast.parse(content)
        elif path.suffix == ".json":
            json.loads(content)
    except (SyntaxError, ValueError):
        issues.append(f"{name}: 構文エラー")
    return issues


def check(root=ROOT):
    paths = changed_paths(root)
    issues = []
    for name in paths:
        issues.extend(inspect_file(root / name, name))
    result = subprocess.run(["git", "diff", "--check", "HEAD"], cwd=root, capture_output=True)
    if result.returncode:
        issues.append("差分の空白/競合を確認してください（git diff --check HEAD）")
    alias = root / "research/reports/リベ関係まとめ_ポータル.html"
    if alias.exists():
        content = alias.read_text()
        if 'content="0;url=./index.html"' not in content or len(content) > 2000:
            issues.append("ポータル旧URLはindex.htmlへの案内専用です。二重編集を停止してください。")
    return paths, issues


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--init-metrics", action="store_true")
    args = parser.parse_args()
    if args.init_metrics:
        directory = ROOT / ".operations-private"
        directory.mkdir(mode=0o700, exist_ok=True)
        path = directory / "weekly_metrics.csv"
        if not path.exists():
            with path.open("x", encoding="utf-8") as stream:
                stream.write((ROOT / "operations/weekly_metrics.template.csv").read_text())
            path.chmod(0o600)
        print("実測台帳を準備しました（既存値は保持）。")
    paths, issues = check()
    for issue in issues:
        print("要確認: " + issue)
    print(f"対象{len(paths)}ファイル、要確認{len(issues)}件。自動コミット・pushは行いません。")
    print("簡易検査は実操作テスト・機密情報の目視確認を代替しません。")
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
