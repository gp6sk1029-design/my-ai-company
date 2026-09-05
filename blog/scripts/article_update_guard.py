"""Require reviewed source and a current WordPress snapshot before replacement."""

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APPROVALS = ROOT / ".operations-private/article_update_approvals.json"


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def fingerprint(post):
    if not isinstance(post.get("content", {}).get("raw"), str) or not post.get("modified_gmt"):
        raise ValueError("本番控えにはcontext=editのcontent.rawとmodified_gmtが必要です。")
    fields = {key: post.get(key) for key in ("id", "modified_gmt", "content", "title", "status", "featured_media")}
    # Rendered HTML can vary without an edit; raw content is the comparison target.
    fields["content"] = post["content"]["raw"]
    fields["title"] = post.get("title", {}).get("raw")
    return hashlib.sha256(json.dumps(fields, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def record(post_id, source, snapshot, evidence, approvals=APPROVALS):
    if not evidence.strip():
        raise ValueError("本文・画像・装飾の比較結果を指定してください。")
    post = json.loads(Path(snapshot).read_text())
    if post.get("id") != post_id:
        raise ValueError("本番控えの投稿IDが一致しません。")
    data = json.loads(approvals.read_text()) if approvals.exists() else {}
    data[str(post_id)] = {"source_sha256": digest(source), "wp_sha256": fingerprint(post),
                          "snapshot": str(Path(snapshot).resolve()), "snapshot_sha256": digest(snapshot),
                          "evidence": evidence, "expires": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()}
    approvals.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = approvals.with_suffix(".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
    temp.replace(approvals)


def require(post_id, source, approvals=APPROVALS):
    data = json.loads(approvals.read_text()) if approvals.exists() else {}
    approval = data.get(str(post_id))
    if not approval:
        raise ValueError("既存記事の全体更新は停止しました。本番控えと原稿の比較・承認記録が必要です。")
    if datetime.fromisoformat(approval["expires"]) <= datetime.now(timezone.utc):
        raise ValueError("更新確認から24時間を超えています。再確認してください。")
    if approval["source_sha256"] != digest(source):
        raise ValueError("確認後に原稿が変わりました。再比較してください。")
    if approval["snapshot_sha256"] != digest(approval["snapshot"]):
        raise ValueError("本番控えが変更されています。再確認してください。")
    return approval


def verify_live(approval, current):
    if fingerprint(current) != approval["wp_sha256"]:
        raise ValueError("確認後に本番記事が変わりました。上書きせず停止します。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--post-id", type=int, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--evidence", required=True)
    args = parser.parse_args()
    record(args.post_id, args.source, args.snapshot, args.evidence)
    print("比較記録を保存しました。実際の投稿はしていません。")
