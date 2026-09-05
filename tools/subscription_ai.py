"""Subscription-only entry point for local Claude/Codex collaboration."""

import argparse
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
try:
    from .collaboration_history import History
except ImportError:
    from collaboration_history import History
try:
    import tomllib
except ImportError:
    import tomli as tomllib

ROOT = Path(__file__).resolve().parents[1]


class SubscriptionError(Exception):
    pass


def validate_model(target, model):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", model):
        raise SubscriptionError("Invalid model name; no request sent.")
    if target == "claude" and model != "opus" and not model.startswith("claude-opus-"):
        raise SubscriptionError("Claude collaboration requires an explicitly selected Opus model.")


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
    parser.add_argument("--model", help="User-selected model for this request; no default")
    args = parser.parse_args(argv)
    history = None
    try:
        if os.environ.get("AI_COLLAB_CHILD"):
            raise SubscriptionError("Recursive collaboration is disabled.")
        if args.target == "claude" and args.action not in {"check", "ask"}:
            raise SubscriptionError("Claude collaboration currently supports advice only.")
        if args.action != "check":
            history = History(args.target, args.action, model=args.model)
            print(f"連携履歴: {history.path}", file=sys.stderr)
            if not args.model or not args.model.strip():
                history.update("モデル選択待ち")
                print(f"{args.target}に依頼するモデルはどれにしますか？ "
                      "ユーザーに確認し、回答後に --model で指定してください。"
                      "既定モデルでは実行しません。", file=sys.stderr)
                return 3
            validate_model(args.target, args.model)
        env = clean_env(os.environ)
        prefix = command_prefix(args.target)
        verify(args.target, prefix, env)
        if args.action == "check":
            print(f"{args.target}: subscription login OK (no model request sent)")
            return 0
        prompt = "" if args.action == "review" else sys.stdin.read().strip()
        if args.action != "review" and not prompt:
            raise SubscriptionError("A prompt must be supplied on stdin.")
        history.update("回答待ち", prompt=prompt or "未コミットの変更をレビューしてください。")
        if args.target == "claude":
            # No shell, plugins, or MCP: the reviewer cannot launch another billed AI.
            command = prefix + ["-p", "--model", args.model, "--tools", "",
                                "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
                                "--disable-slash-commands", "--permission-mode", "dontAsk"]
        elif args.action == "review":
            command = prefix + ["--model", args.model, "-c", f"review_model={json.dumps(args.model)}",
                                "--sandbox", "read-only", "review", "--uncommitted"]
        else:
            sandbox = "workspace-write" if args.action == "implement" else "read-only"
            command = prefix + ["--model", args.model, "--sandbox", sandbox, "exec", "-"]
        if prompt:
            prompt = ("AI collaboration: do not invoke other AI agents or paid APIs. "
                      "Do not change authentication or billing settings.\n" + prompt)
        # No retries, billing fallback, shell expansion, or caller-supplied CLI options.
        result = subprocess.run(command, input=prompt, text=True, env=env, cwd=ROOT,
                                capture_output=True)
        answer = result.stdout or ""
        history.update("完了" if result.returncode == 0 else "停止（実行エラー）", answer=answer)
        if answer:
            print(answer, end="" if answer.endswith("\n") else "\n")
        if result.returncode:
            print("連携が停止しました。APIへの切替・再試行は行いません。", file=sys.stderr)
        return result.returncode
    except (SubscriptionError, OSError, ValueError, subprocess.TimeoutExpired) as exc:
        if history:
            history.update("停止（認証・入力・実行を確認してください）")
        print(f"Subscription-only: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        if history:
            history.update("中断")
        return 130


if __name__ == "__main__":
    sys.exit(main())
