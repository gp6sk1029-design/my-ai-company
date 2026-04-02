#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
メール自動下書き生成スクリプト
・Thunderbird起動中のみ動作
・受信から5分以内の新着メールのみ対象
・迷惑メール・メルマガを除外
・Gemini APIで返信文を生成してDrafts mboxに保存
・60秒ごとに繰り返す常駐型
"""

import mailbox
import json
import os
import re
import email
import email.header
import email.utils
import subprocess
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from google import genai
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

# ── 設定 ────────────────────────────────────────────────────
THUNDERBIRD_MAIL_DIR = Path(r"C:\Users\SEIGI-N13\AppData\Roaming\Thunderbird\Profiles\ia5jx4ac.default-release\Mail\mail.ime-group.co.jp")
INBOX_PATH           = THUNDERBIRD_MAIL_DIR / "Inbox"
DRAFTS_PATH          = THUNDERBIRD_MAIL_DIR / "Drafts"
LAST_PROCESSED_FILE  = Path(__file__).parent / "last_processed.json"
LOG_DIR              = Path(__file__).parent / "logs"

MY_EMAIL       = os.getenv("MY_EMAIL", "sy-kouda@ime-group.co.jp")
MY_NAME        = os.getenv("MY_NAME", "幸田")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

RECENT_MINUTES = 5    # 受信から何分以内を対象にするか
LOOP_INTERVAL  = 60   # 何秒ごとにチェックするか

# 迷惑メール・メルマガ・返信不要の判定パターン
SPAM_PATTERNS = [
    r"no.?reply",
    r"noreply",
    r"newsletter",
    r"unsubscribe",
    r"配信停止",
    r"メルマガ",
    r"@.*marketing",
    r"@.*promo",
    r"iweb_search",
    r"mail-news",
    r"bounce",
    r"mailer-daemon",
    r"自動送信",
    r"do.not.reply",
]


# ── ユーティリティ ───────────────────────────────────────────

def decode_header(header_str: str) -> str:
    """メールヘッダーをデコードして文字列で返す"""
    if not header_str:
        return ""
    parts = email.header.decode_header(header_str)
    result = []
    for part, charset in parts:
        if isinstance(part, bytes):
            charset = charset or "utf-8"
            result.append(part.decode(charset, errors="replace"))
        else:
            result.append(part)
    return "".join(result)


def get_body(msg) -> str:
    """メール本文を取得（最大3000文字）"""
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                charset = part.get_content_charset() or "utf-8"
                try:
                    body = part.get_payload(decode=True).decode(charset, errors="replace")
                    break
                except Exception:
                    pass
    else:
        charset = msg.get_content_charset() or "utf-8"
        try:
            body = msg.get_payload(decode=True).decode(charset, errors="replace")
        except Exception:
            body = str(msg.get_payload())
    return body[:3000]


# ── Thunderbird起動確認 ──────────────────────────────────────

def is_thunderbird_running() -> bool:
    """Thunderbirdプロセスが起動中か確認する"""
    try:
        result = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq thunderbird.exe"],
            capture_output=True, text=True
        )
        return "thunderbird.exe" in result.stdout.lower()
    except Exception:
        return False


# ── 受信時刻確認 ────────────────────────────────────────────

def is_recent(msg, minutes: int = RECENT_MINUTES) -> bool:
    """受信日時が指定分以内かどうか判定する（Receivedヘッダーを優先）"""
    now = datetime.now(timezone.utc)

    # Receivedヘッダーから受信時刻を取得（最初の1行を使用）
    received = msg.get("Received", "")
    if received:
        # ";" の後ろに日時が書かれている形式
        parts = received.split(";")
        if len(parts) >= 2:
            date_str = parts[-1].strip()
            try:
                dt = email.utils.parsedate_to_datetime(date_str)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return (now - dt) <= timedelta(minutes=minutes)
            except Exception:
                pass

    # フォールバック：Dateヘッダーを使用
    date_str = msg.get("Date", "")
    if date_str:
        try:
            dt = email.utils.parsedate_to_datetime(date_str)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return (now - dt) <= timedelta(minutes=minutes)
        except Exception:
            pass

    return False


# ── 迷惑メール・返信不要判定 ────────────────────────────────

def needs_reply(msg) -> bool:
    """返信が必要なメールかどうか判定する（Trueなら返信必要）"""
    sender  = decode_header(msg.get("From", ""))
    subject = decode_header(msg.get("Subject", ""))

    # X-Spam-Statusヘッダー確認
    if "Yes" in msg.get("X-Spam-Status", ""):
        return False

    # Junkフラグ確認
    if msg.get("X-Mozilla-Status", "") == "0100":
        return False

    # 自動送信・返信不要パターン確認
    check = (sender + " " + subject).lower()
    for pattern in SPAM_PATTERNS:
        if re.search(pattern, check, re.IGNORECASE):
            return False

    return True


# ── 処理済み管理 ────────────────────────────────────────────

def load_processed() -> set:
    if LAST_PROCESSED_FILE.exists():
        with open(LAST_PROCESSED_FILE, "r", encoding="utf-8") as f:
            return set(json.load(f))
    return set()


def save_processed(processed: set):
    with open(LAST_PROCESSED_FILE, "w", encoding="utf-8") as f:
        json.dump(list(processed), f, ensure_ascii=False, indent=2)


# ── 過去のやり取り取得 ───────────────────────────────────────

def get_past_thread(sender_email: str, inbox: mailbox.mbox) -> list:
    """送信者との過去のやり取りを直近5件取得"""
    thread = []
    for key in inbox.keys():
        msg = inbox[key]
        msg_from = msg.get("From", "")
        msg_to   = msg.get("To", "")
        if sender_email in msg_from or sender_email in msg_to:
            thread.append({
                "date":    decode_header(msg.get("Date", "")),
                "from":    decode_header(msg.get("From", "")),
                "subject": decode_header(msg.get("Subject", "")),
                "body":    get_body(msg)[:500],
            })
    return thread[-5:]


# ── Gemini APIで返信文生成 ───────────────────────────────────

def generate_reply(subject: str, sender: str, body: str, thread: list) -> str:
    client = genai.Client(api_key=GEMINI_API_KEY)

    thread_text = ""
    if thread:
        thread_text = "\n\n【過去のやり取り（直近5件）】\n"
        for t in thread:
            thread_text += (
                f"日付: {t['date']}\n"
                f"送信者: {t['from']}\n"
                f"件名: {t['subject']}\n"
                f"本文: {t['body']}\n---\n"
            )

    prompt = f"""あなたはビジネスメールの返信文を作成するアシスタントです。
以下のメールに対する返信文を日本語で作成してください。

【受信メール情報】
件名: {subject}
送信者: {sender}
本文:
{body}
{thread_text}

【返信文の要件】
- ビジネスメールとして適切な敬語・文体を使用する
- 受領確認・お礼・適切な対応を含める
- 署名部分は「【署名】」というプレースホルダーにする
- 簡潔にまとめる（長すぎない）

返信文のみを出力してください。説明文は不要です。"""

    response = client.models.generate_content(
        model="gemini-2.0-flash-lite",
        contents=prompt,
    )
    return response.text


# ── 下書き保存 ──────────────────────────────────────────────

def write_draft(subject: str, sender: str, reply_body: str):
    """ThunderbirdのDrafts mboxに下書きを書き込む"""
    now           = datetime.now()
    date_str      = email.utils.formatdate(localtime=True)
    reply_subject = f"Re: {subject}" if not subject.startswith("Re:") else subject

    draft = (
        f"From - {now.strftime('%a %b %d %H:%M:%S %Y')}\n"
        f"X-Mozilla-Status: 0008\n"
        f"X-Mozilla-Status2: 00000000\n"
        f"X-Mozilla-Keys:\n"
        f"Date: {date_str}\n"
        f"From: {MY_NAME} <{MY_EMAIL}>\n"
        f"To: {sender}\n"
        f"Subject: {reply_subject}\n"
        f"MIME-Version: 1.0\n"
        f"Content-Type: text/plain; charset=\"UTF-8\"\n"
        f"Content-Transfer-Encoding: 8bit\n"
        f"\n"
        f"{reply_body}\n"
        f"\n"
    )

    with open(DRAFTS_PATH, "a", encoding="utf-8", newline="\n") as f:
        f.write(draft)

    # .msf（インデックス）を削除 → Thunderbirdが次回起動時に再インデックスする
    msf_path = str(DRAFTS_PATH) + ".msf"
    if os.path.exists(msf_path):
        os.remove(msf_path)


# ── ログ出力 ─────────────────────────────────────────────────

def log(msg: str):
    LOG_DIR.mkdir(exist_ok=True)
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line)
    log_file = LOG_DIR / f"{datetime.now().strftime('%Y-%m')}.log"
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(line + "\n")


# ── 1回分のチェック処理 ──────────────────────────────────────

def check_once(processed: set) -> int:
    """Inboxをチェックして新着メールの下書きを生成する。作成件数を返す"""
    inbox     = mailbox.mbox(str(INBOX_PATH))
    new_count = 0

    for key in inbox.keys():
        msg  = inbox[key]
        uidl = msg.get("X-UIDL", str(key))

        # 処理済みはスキップ
        if uidl in processed:
            continue

        # 自分が送信したメールはスキップ
        sender_raw = msg.get("From", "")
        if MY_EMAIL in sender_raw:
            processed.add(uidl)
            continue

        # 受信から5分以内でないものはスキップ（古いメールを無視）
        if not is_recent(msg, RECENT_MINUTES):
            processed.add(uidl)
            continue

        # 返信不要（迷惑・メルマガ・自動送信）はスキップ
        if not needs_reply(msg):
            subject = decode_header(msg.get("Subject", ""))
            log(f"  スキップ（返信不要）: {subject}")
            processed.add(uidl)
            continue

        subject      = decode_header(msg.get("Subject", "（件名なし）"))
        sender       = decode_header(sender_raw)
        body         = get_body(msg)
        sender_email = email.utils.parseaddr(sender_raw)[1]

        log(f"  新着メール検出: {subject} / {sender}")

        # 過去のやり取りを取得
        thread = get_past_thread(sender_email, inbox)

        # Gemini APIで返信文生成 → 下書き保存
        try:
            reply = generate_reply(subject, sender, body, thread)
            write_draft(subject, sender, reply)
            log(f"  下書き保存完了: {subject}")
            new_count += 1
        except Exception as e:
            log(f"  エラー（{subject}）: {e}")

        processed.add(uidl)

    inbox.close()
    return new_count


# ── メイン（60秒ループ） ─────────────────────────────────────

def main():
    if not GEMINI_API_KEY:
        log("エラー: GEMINI_API_KEY が設定されていません。.envファイルを確認してください。")
        return

    log("メール自動下書きスクリプト 起動")
    processed = load_processed()

    while True:
        # Thunderbird起動確認
        if not is_thunderbird_running():
            log("  Thunderbird未起動 - 60秒後に再確認")
            time.sleep(LOOP_INTERVAL)
            continue

        # メールチェック
        log("メールチェック開始")
        try:
            count = check_once(processed)
            save_processed(processed)
            log(f"完了 - 新規下書き {count} 件作成")
        except Exception as e:
            log(f"チェック中にエラー: {e}")

        # 60秒待機
        log(f"{LOOP_INTERVAL}秒後に再チェック")
        time.sleep(LOOP_INTERVAL)


if __name__ == "__main__":
    main()
