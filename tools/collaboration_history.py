"""Local-only, escaped HTML history for subscription AI calls."""

from datetime import datetime
from html import escape
import json
import os
from pathlib import Path
import uuid

DIRECTORY = Path(__file__).resolve().parents[1] / ".ai-collaboration"
CSS = """
*{box-sizing:border-box}body{margin:0;background:#f5f7f8;color:#202b30;font:15px/1.7 system-ui,sans-serif;letter-spacing:0}
header{background:#fff;border-bottom:1px solid #dce2e5;padding:22px max(20px,calc((100% - 960px)/2))}
h1{font-size:24px;margin:0}h2{font-size:17px;margin:0 0 12px}p{margin:8px 0}
main{max-width:1000px;margin:auto;padding:24px 20px}a{color:#126b65;text-decoration:none}a:hover{text-decoration:underline}
.meta{font-size:13px;color:#617078}.status{display:inline-block;color:#16665f;background:#e3f2ed;padding:2px 10px;border-radius:4px}
.flow{padding:16px 0;border-bottom:1px solid #dce2e5;margin-bottom:22px;font-weight:600}
section{padding:4px 0 24px;margin-bottom:22px;border-bottom:1px solid #dce2e5}
pre{font:14px/1.8 system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
.response{border-left:3px solid #7771a5;padding-left:18px}.request{border-left:3px solid #27877a;padding-left:18px}
.row{display:block;padding:18px 0;border-bottom:1px solid #dce2e5;color:inherit}.row strong{display:block;overflow-wrap:anywhere}
.empty{padding:45px 0;color:#617078}details{margin-top:24px}summary{cursor:pointer;color:#617078}
@media(max-width:520px){h1{font-size:21px}main{padding:18px 16px}header{padding:18px 16px}.flow{font-size:14px}}
"""


def page(title, body, refresh=False):
    reload = '<meta http-equiv="refresh" content="5">' if refresh else ""
    return (f'<!doctype html><html lang="ja"><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1">{reload}'
            f'<title>{escape(title)} | AI連携履歴</title><style>{CSS}</style>'
            f'<header><h1>AI連携履歴</h1><p class="meta">このPC内のみ · 契約ログイン限定</p></header>'
            f'<main>{body}</main></html>')


def write_private(path, text):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(text)
    os.replace(temp, path)


def index(directory=DIRECTORY):
    rows = []
    for path in sorted(directory.glob("*.json"), reverse=True):
        data = json.loads(path.read_text(encoding="utf-8"))
        rows.append(f'<a class="row" href="{escape(path.stem)}.html">'
                    f'<span class="meta">{escape(data["time"])} · {escape(data["route"])}</span>'
                    f'<strong>{escape(data["prompt"][:100] or data["action"])}</strong>'
                    f'<span class="status">{escape(data["status"])}</span></a>')
    body = '<h2>やり取り一覧</h2>' + ("".join(rows) or '<p class="empty">まだ連携の履歴はありません。</p>')
    body += '<details><summary>保存内容について</summary><p>今後この窓口を通した依頼と回答を記録します。内部の思考過程や認証情報は記録しません。依頼・回答に含まれる業務情報はこのPCに残ります。</p></details>'
    write_private(directory / "index.html", page("一覧", body, True))


class History:
    def __init__(self, target, action, directory=DIRECTORY):
        self.directory = directory
        self.id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
        self.data = dict(time=datetime.now().astimezone().isoformat(timespec="seconds"),
                         route="Claude Code → Codex" if target == "codex" else "Codex → Claude Code",
                         action=action, prompt="", answer="", status="契約認証を確認中", events=[])
        self.update(self.data["status"])

    @property
    def path(self):
        return self.directory / (self.id + ".html")

    def update(self, status, prompt=None, answer=None):
        self.data["status"] = status
        self.data["events"].append(datetime.now().strftime("%H:%M:%S") + "  " + status)
        if prompt is not None:
            self.data["prompt"] = prompt
        if answer is not None:
            self.data["answer"] = answer
        active = status in {"契約認証を確認中", "回答待ち"}
        body = (f'<a href="index.html">← 一覧</a><div class="flow">{escape(self.data["route"])}</div>'
                f'<p class="meta">{escape(self.data["time"])} · {escape(self.data["action"])}</p>'
                f'<p><span class="status">{escape(status)}</span></p>'
                f'<section><h2>進行状況</h2><pre>{escape(chr(10).join(self.data["events"]))}</pre></section>'
                f'<section class="request"><h2>依頼</h2><pre>{escape(self.data["prompt"] or "依頼の準備中")}</pre></section>'
                f'<section class="response"><h2>回答</h2><pre>{escape(self.data["answer"] or ("回答が返ると表示されます。" if active else "回答はありません。"))}</pre></section>')
        write_private(self.path, page(self.data["route"], body, active))
        write_private(self.directory / (self.id + ".json"), json.dumps(self.data, ensure_ascii=False))
        index(self.directory)


if __name__ == "__main__":
    index()
    print(DIRECTORY / "index.html")
