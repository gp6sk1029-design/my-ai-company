"""Fast-forward only startup sync; preserve all local work."""

from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    dirty = subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT)
    if dirty:
        print("ローカル変更があるため自動pullを省略。変更は保持しています。")
        return 0
    branch = subprocess.check_output(["git", "branch", "--show-current"], cwd=ROOT, text=True).strip()
    if branch != "main":
        print("作業ブランチのため自動pullを省略。必要時に対象ブランチを確認して同期してください。")
        return 0
    result = subprocess.run(["git", "pull", "--ff-only", "origin", "main"], cwd=ROOT, timeout=20)
    if result.returncode:
        print("同期できませんでした。自動マージやリセットは行いません。")
    return result.returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, subprocess.SubprocessError):
        print("起動時同期を完了できませんでした。Git状態を確認してください。")
        raise SystemExit(1)
