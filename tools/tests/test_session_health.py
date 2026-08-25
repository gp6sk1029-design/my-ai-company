import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


TOOLS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS_DIR))

from session_health import auto_compaction_enabled, detect_runtime, evaluate  # noqa: E402


class RuntimeDetectionTest(unittest.TestCase):
    def test_codex_environment_is_detected(self):
        with patch.dict(os.environ, {"CODEX_SESSION_ID": "test-session"}, clear=True):
            self.assertEqual(detect_runtime("auto"), "codex")

    def test_explicit_runtime_takes_priority(self):
        with patch.dict(os.environ, {"CODEX_SESSION_ID": "test-session"}, clear=True):
            self.assertEqual(detect_runtime("claude-code"), "claude-code")

    def test_codex_uses_auto_compaction(self):
        self.assertTrue(auto_compaction_enabled("codex"))

    def test_claude_code_uses_auto_compaction_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertTrue(auto_compaction_enabled("claude-code"))

    def test_claude_code_warning_returns_when_auto_compaction_is_disabled(self):
        for variable in ("DISABLE_AUTO_COMPACT", "DISABLE_COMPACT"):
            with self.subTest(variable=variable):
                with patch.dict(os.environ, {variable: "1"}, clear=True):
                    self.assertFalse(auto_compaction_enabled("claude-code"))

    def test_missing_usage_never_falls_back_to_cumulative_warning(self):
        metrics = {
            "context_tokens": 0,
            "size_mb": 99,
            "user_turns": 999,
        }
        result = evaluate(metrics, window=200_000)
        self.assertEqual(result["overall"], "OK")
        self.assertEqual(metrics["judge_mode"], "unavailable(usage情報なし・判定保留)")


if __name__ == "__main__":
    unittest.main()
