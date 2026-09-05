import io
import subprocess
import unittest
from unittest.mock import patch

from tools import subscription_ai as bridge


class SubscriptionTests(unittest.TestCase):
    def test_environment_drops_credentials_and_overrides(self):
        env = bridge.clean_env({"HOME": "/home/test", "PATH": "/bin",
                                "ANTHROPIC_API_KEY": "secret",
                                "OPENAI_API_KEY": "secret",
                                "ANTHROPIC_AUTH_TOKEN": "secret",
                                "CLAUDE_CODE_USE_BEDROCK": "1",
                                "CODEX_HOME": "/other", "OPENAI_BASE_URL": "elsewhere"})
        self.assertEqual(env, {"HOME": "/home/test", "PATH": "/bin", "AI_COLLAB_CHILD": "1"})

    def test_api_login_stops_before_generation(self):
        with patch.object(bridge, "command_prefix", return_value=["codex"]), \
                patch.dict(bridge.os.environ, {}, clear=True), \
                patch.object(bridge.subprocess, "run", return_value=subprocess.CompletedProcess(
                    [], 0, "Logged in using an API key", "")) as run:
            self.assertEqual(bridge.main(["codex", "ask"]), 2)
            self.assertEqual(run.call_count, 1)

    def test_unknown_claude_auth_rejected(self):
        for value in ('{}', 'invalid', '{"loggedIn":true,"authMethod":"api_key"}'):
            with patch.object(bridge.subprocess, "run", return_value=subprocess.CompletedProcess(
                    [], 0, value, "")):
                with self.assertRaises(bridge.SubscriptionError):
                    bridge.verify("claude", ["claude"], {})

    def test_subscription_auth_accepted(self):
        values = {"codex": "Logged in using ChatGPT", "claude":
                  '{"loggedIn":true,"authMethod":"claude.ai",'
                  '"apiProvider":"firstParty","subscriptionType":"pro"}'}
        for target, output in values.items():
            with patch.object(bridge.subprocess, "run", return_value=subprocess.CompletedProcess(
                    [], 0, output, "")):
                bridge.verify(target, [target], {})

    def test_failed_generation_is_not_retried(self):
        with patch.object(bridge, "command_prefix", return_value=["codex"]), \
                patch.object(bridge, "verify"), \
                patch.dict(bridge.os.environ, {}, clear=True), \
                patch.object(bridge.sys, "stdin", io.StringIO("review $(not a command)")), \
                patch.object(bridge.subprocess, "run", return_value=subprocess.CompletedProcess(
                    [], 7)) as run:
            self.assertEqual(bridge.main(["codex", "ask"]), 7)
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0], ["codex", "--sandbox", "read-only", "exec", "-"])
            self.assertIn("$(not a command)", run.call_args.kwargs["input"])

    def test_recursive_call_stops(self):
        with patch.dict(bridge.os.environ, {"AI_COLLAB_CHILD": "1"}), \
                patch.object(bridge.subprocess, "run") as run:
            self.assertEqual(bridge.main(["codex", "ask"]), 2)
            run.assert_not_called()

    def test_claude_has_no_tools_or_external_mcp(self):
        with patch.object(bridge, "command_prefix", return_value=["claude"]), \
                patch.object(bridge, "verify"), \
                patch.dict(bridge.os.environ, {}, clear=True), \
                patch.object(bridge.sys, "stdin", io.StringIO("advice")), \
                patch.object(bridge.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
            self.assertEqual(bridge.main(["claude", "ask"]), 0)
            command = run.call_args.args[0]
            self.assertEqual(command[command.index("--tools") + 1], "")
            self.assertIn("--strict-mcp-config", command)
            self.assertNotIn("--bare", command)


if __name__ == "__main__":
    unittest.main()
