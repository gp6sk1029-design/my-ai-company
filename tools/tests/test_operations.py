import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from tools.operations_check import inspect_file, changed_paths
from tools import session_start
from blog.scripts import article_update_guard as guard


class OperationsTests(unittest.TestCase):
    def test_secret_detection_does_not_print_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.txt"
            value = "sk-" + "A" * 30
            path.write_text(value)
            issues = inspect_file(path, path.name)
            self.assertTrue(issues)
            self.assertNotIn(value, str(issues))

    def test_invalid_json_and_env(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.json"
            path.write_text("{")
            self.assertIn("構文", str(inspect_file(path, path.name)))
            env = Path(directory) / ".env"
            env.write_text("private")
            self.assertTrue(inspect_file(env, env.name))

    def test_changed_paths_includes_staged_and_untracked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)
            git("init")
            git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "base")
            (root / "staged.txt").write_text("one")
            git("add", "staged.txt")
            (root / "untracked.txt").write_text("two")
            self.assertEqual(changed_paths(root), ["staged.txt", "untracked.txt"])

    def test_dirty_start_never_pulls(self):
        with patch.object(session_start.subprocess, "check_output", return_value=b" M work.py"), \
                patch.object(session_start.subprocess, "run") as run:
            self.assertEqual(session_start.main(), 0)
            run.assert_not_called()

    def test_clean_main_only_fast_forwards(self):
        with patch.object(session_start.subprocess, "check_output", side_effect=[b"", "main\n"]), \
                patch.object(session_start.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
            self.assertEqual(session_start.main(), 0)
            self.assertEqual(run.call_args.args[0], ["git", "pull", "--ff-only", "origin", "main"])


class ArticleGuardTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.source = self.root / "article.md"
        self.source.write_text("reviewed article")
        self.snapshot = self.root / "snapshot.json"
        self.post = {"id": 42, "modified_gmt": "2026-09-05T10:00:00", "content": {"raw": "original"}}
        self.snapshot.write_text(json.dumps(self.post))
        self.approvals = self.root / "approvals.json"

    def record(self):
        guard.record(42, self.source, self.snapshot, "本文・画像を照合", self.approvals)

    def test_unreviewed_source_blocked(self):
        with self.assertRaises(ValueError):
            guard.require(42, self.source, self.approvals)

    def test_reviewed_source_passes_and_live_edit_blocks(self):
        self.record()
        approval = guard.require(42, self.source, self.approvals)
        guard.verify_live(approval, self.post)
        self.post["content"]["raw"] = "another editor's work"
        with self.assertRaises(ValueError):
            guard.verify_live(approval, self.post)

    def test_changed_source_blocked(self):
        self.record()
        self.source.write_text("new unreviewed change")
        with self.assertRaises(ValueError):
            guard.require(42, self.source, self.approvals)

    def test_expired_approval_blocked(self):
        self.record()
        data = json.loads(self.approvals.read_text())
        data["42"]["expires"] = "2000-01-01T00:00:00+00:00"
        self.approvals.write_text(json.dumps(data))
        with self.assertRaises(ValueError):
            guard.require(42, self.source, self.approvals)

    def test_missing_raw_snapshot_rejected(self):
        with self.assertRaises(ValueError):
            guard.fingerprint({"id": 42, "content": {"rendered": "not the original"}})
