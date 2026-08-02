"""記事めしGASの非公開認証情報を安全に読み込む共通処理。"""

import os
import subprocess
import sys


DEFAULT_GAS_URL = (
    "https://script.google.com/macros/s/"
    "AKfycby9BSLfRFE_oxx3xi0wez1qD_crpTu6xc6gd5MI0OYa9dwycX2LuIoRD9NklcgOjTSm9g/exec"
)
KEYCHAIN_SERVICE = "article-meshi-gas-token"


def load_gas_config() -> tuple[str, str]:
    """GAS URLとトークンを環境変数、またはmacOSキーチェーンから返す。"""
    gas_url = os.environ.get("BLOG_CAPTURE_GAS_URL", DEFAULT_GAS_URL).strip()
    token = os.environ.get("BLOG_CAPTURE_SHARED_TOKEN", "").strip()

    if not token and sys.platform == "darwin":
        try:
            token = subprocess.run(
                [
                    "security",
                    "find-generic-password",
                    "-a",
                    os.environ.get("USER", ""),
                    "-s",
                    KEYCHAIN_SERVICE,
                    "-w",
                ],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
        except (subprocess.CalledProcessError, FileNotFoundError):
            token = ""

    if not token:
        raise RuntimeError(
            "記事めしGASトークンが未設定です。BLOG_CAPTURE_SHARED_TOKEN環境変数、"
            f"またはmacOSキーチェーン {KEYCHAIN_SERVICE} を設定してください。"
        )
    return gas_url, token
