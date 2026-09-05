"""Subscription-only entry point for local Claude/Codex collaboration."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
try:
    import tomllib
except ImportError:
    import tomli as tomllib

ROOT = Path(__file__).resolve().parents[1]


class SubscriptionError(Exception):
    pass


def clean_env(source):
    # Do not inherit API keys, provider overrides, or nested-agent credentials.
    keep = {"HOME", "PATH", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "TERM",
            "SYSTEMROOT", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
            "USER", "LOGNAME", "XPC_FLAGS", "XPC_SERVICE_NAME", "__CF_USER_TEXT_ENCODING"}
    env = {key: value for key, value in source.items() if key in keep}
    env["AI_COLLAB_CHILD"] = "1"
    return env


def command_prefix(target):
    binary = shutil.which(target)
    if not binary:
        raise SubscriptionError(f"{target}: CLI is not installed.")
    if target == "claude":
        # Empty sources prevent settings.env and apiKeyHelper from restoring keys.
        return [binary, "--setting-sources", "", "--settings",
                '{"forceLoginMethod":"claudeai"}']
    # A custom definition of the built-in provider could change the billing route.
    for path in (Path.home() / ".codex/config.toml", ROOT / ".codex/config.toml"):
        if path.exists():
            config = tomllib.loads(path.read_text())
            if config.get("model_providers", {}).get("openai"):
                raise SubscriptionError("Custom OpenAI provider detected; stopped.")
    return [binary, "-c", 'forced_login_method="chatgpt"',
            "-c", 'model_provider="openai"']


def verify(target, prefix, env):
    args = ["auth", "status"] if target == "claude" else ["login", "status"]
    result = subprocess.run(prefix + args, env=env, cwd=ROOT,
                            capture_output=True, text=True, timeout=30)
    if target == "claude":
        try:
            status = json.loads(result.stdout)
        except ValueError:
            status = {}
        valid = (status.get("loggedIn") is True
                 and status.get("authMethod") == "claude.ai"
                 and status.get("apiProvider") == "firstParty"
                 and status.get("subscriptionType") in {"pro", "max"})
    else:
        valid = (result.stdout + result.stderr).strip() == "Logged in using ChatGPT"
    if result.returncode or not valid:
        raise SubscriptionError(f"{target}: subscription login not confirmed; no request sent.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", choices=("codex", "claude"))
    parser.add_argument("action", choices=("check", "ask", "review", "implement"))
    args = parser.parse_args(argv)
    try:
        if os.environ.get("AI_COLLAB_CHILD"):
            raise SubscriptionError("Recursive collaboration is disabled.")
        if args.target == "claude" and args.action not in {"check", "ask"}:
            raise SubscriptionError("Claude collaboration currently supports advice only.")
        env = clean_env(os.environ)
        prefix = command_prefix(args.target)
        verify(args.target, prefix, env)
        if args.action == "check":
            print(f"{args.target}: subscription login OK (no model request sent)")
            return 0
        prompt = "" if args.action == "review" else sys.stdin.read().strip()
        if args.action != "review" and not prompt:
            raise SubscriptionError("A prompt must be supplied on stdin.")
        if args.target == "claude":
            # No shell, plugins, or MCP: the reviewer cannot launch another billed AI.
            command = prefix + ["-p", "--model", "opus", "--tools", "",
                                "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
                                "--disable-slash-commands", "--permission-mode", "dontAsk"]
        elif args.action == "review":
            command = prefix + ["--sandbox", "read-only", "review", "--uncommitted"]
        else:
            sandbox = "workspace-write" if args.action == "implement" else "read-only"
            command = prefix + ["--sandbox", sandbox, "exec", "-"]
        if prompt:
            prompt = ("AI collaboration: do not invoke other AI agents or paid APIs. "
                      "Do not change authentication or billing settings.\n" + prompt)
        # No retries, billing fallback, shell expansion, or caller-supplied CLI options.
        return subprocess.run(command, input=prompt, text=True, env=env, cwd=ROOT).returncode
    except (SubscriptionError, OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(f"Subscription-only: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
