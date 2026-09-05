import json
from pathlib import Path
import tempfile
import unittest

from tools.collaboration_history import History, index


class HistoryTests(unittest.TestCase):
    def test_escaped_content_and_completed_refresh(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            history = History("codex", "ask", path, model="gpt-test")
            history.update("回答待ち", prompt='<script>alert(1)</script>')
            self.assertIn('http-equiv="refresh"', history.path.read_text())
            history.update("完了", answer="回答です。")
            html = history.path.read_text()
            self.assertNotIn("<script>", html)
            self.assertIn("&lt;script&gt;", html)
            self.assertNotIn('http-equiv="refresh"', html)
            self.assertIn("回答です。", html)
            self.assertIn("指定モデル: gpt-test", html)
            self.assertIn("gpt-test", (path / "index.html").read_text())
            self.assertEqual(history.path.stat().st_mode & 0o777, 0o600)
            self.assertIn(history.id, (path / "index.html").read_text())

    def test_distinct_runs_and_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            first = History("codex", "review", path)
            second = History("claude", "ask", path)
            second.update("停止（実行エラー）")
            self.assertNotEqual(first.path, second.path)
            self.assertEqual(len(list(path.glob("*.json"))), 2)
            self.assertIn("停止", second.path.read_text())
            saved = json.loads((path / (second.id + ".json")).read_text())
            self.assertEqual(saved["route"], "Codex → Claude Code")

    def test_empty_index(self):
        with tempfile.TemporaryDirectory() as directory:
            index(Path(directory))
            self.assertIn("まだ連携", (Path(directory) / "index.html").read_text())
