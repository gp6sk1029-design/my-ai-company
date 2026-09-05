"""Exercise a real local subprocess, not an AI service or a billing API."""

import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from tools import subscription_ai as bridge
from tools.collaboration_history import History


class ProcessTests(unittest.TestCase):
    def test_real_process_response_reaches_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def history(target, action, model=None):
                return History(target, action, root, model)
            child = "import sys; text=sys.stdin.read(); print('LOCAL TEST RESPONSE: '+text.splitlines()[-1])"
            with patch.object(bridge, "History", side_effect=history), \
                    patch.object(bridge, "command_prefix", return_value=[sys.executable, "-c", child]), \
                    patch.object(bridge, "verify"), \
                    patch.dict(bridge.os.environ, {}, clear=True), \
                    patch.object(bridge.sys, "stdin", io.StringIO("local fixture")):
                self.assertEqual(bridge.main(["codex", "ask", "--model", "gpt-test"]), 0)
            record = json.loads(next(root.glob("*.json")).read_text())
            self.assertEqual(record["status"], "完了")
            self.assertIn("LOCAL TEST RESPONSE: local fixture", record["answer"])
            self.assertEqual(record["model"], "gpt-test")

    def test_process_failure_is_recorded_without_stderr(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def history(target, action, model=None):
                return History(target, action, root, model)
            child = "import sys; sys.stdin.read(); print('PRIVATE_DIAGNOSTIC',file=sys.stderr); sys.exit(9)"
            with patch.object(bridge, "History", side_effect=history), \
                    patch.object(bridge, "command_prefix", return_value=[sys.executable, "-c", child]), \
                    patch.object(bridge, "verify"), \
                    patch.dict(bridge.os.environ, {}, clear=True), \
                    patch.object(bridge.sys, "stdin", io.StringIO("local fixture")):
                self.assertEqual(bridge.main(["claude", "ask", "--model", "opus"]), 9)
            for path in root.iterdir():
                self.assertNotIn("PRIVATE_DIAGNOSTIC", path.read_text())
            record = json.loads(next(root.glob("*.json")).read_text())
            self.assertIn("停止", record["status"])
