# -*- coding: utf-8 -*-
"""YouTubeの字幕（文字起こし）を取得してテキストにする。

動画URLを渡すと、字幕をタイムスタンプ付きテキストで保存する。
リベシティ合宿やSEO解説などの動画教材を、資料と同じように読み込ませるために使う。

使い方: python3 blog/scripts/youtube_transcript.py <YouTube URL> [出力先.txt]
字幕が無い動画は「字幕なし」と表示して終了する（その場合は音声からの文字起こしが必要）。
"""
import sys, re, json, html, pathlib, urllib.request
import yt_dlp

def fetch(url, outfile=None):
    # YouTubeのボット検出を避けるため、通るクライアントを順に試す
    #（既定の web クライアントは "The page needs to be reloaded" で弾かれることがある）
    info = None
    last = None
    for client in (["android"], ["ios"], ["tv"], ["mweb"], ["web_safari"]):
        try:
            opts = {"skip_download": True, "quiet": True, "no_warnings": True,
                    "extractor_args": {"youtube": {"player_client": client}}}
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
            break
        except Exception as e:
            last = e
    if info is None:
        print(f"❌ 動画情報を取得できませんでした: {str(last)[:120]}")
        return None
    title = info.get("title", "")
    dur = info.get("duration") or 0
    chan = info.get("uploader", "")
    date = info.get("upload_date", "")
    subs = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}
    src, kind = None, None
    for lang in ("ja", "ja-JP", "en"):
        if lang in subs:  src, kind = subs[lang], f"公式字幕({lang})"; break
    if not src:
        for lang in ("ja", "ja-orig", "ja-JP", "en", "en-orig"):
            if lang in auto: src, kind = auto[lang], f"自動字幕({lang})"; break
    print(f"タイトル: {title}")
    print(f"チャンネル: {chan} / 公開: {date} / 長さ: {dur//60}分{dur%60}秒")
    if not src:
        print("❌ 字幕なし（音声からの文字起こしが必要）")
        return None
    # json3 形式を優先（テキストが取りやすい）
    fmt = next((f for f in src if f.get("ext") == "json3"), src[0])
    print(f"字幕: {kind} / 形式: {fmt.get('ext')}")
    req = urllib.request.Request(fmt["url"], headers={"User-Agent": "Mozilla/5.0"})
    raw = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "ignore")
    if fmt.get("ext") == "json3":
        data = json.loads(raw)
        lines = []
        for ev in data.get("events", []):
            t = "".join(s.get("utf8", "") for s in ev.get("segs", []) or [])
            t = t.strip()
            if t: lines.append((ev.get("tStartMs", 0)//1000, t))
        text = "\n".join(f"[{s//60:02d}:{s%60:02d}] {t}" for s, t in lines)
    else:
        text = html.unescape(re.sub(r"<[^>]+>", "", raw))
    out = pathlib.Path(outfile or "yt_transcript.txt")
    out.write_text(f"# {title}\n# {chan} / {date} / {dur//60}分\n# 出典: {url}\n\n{text}")
    print(f"✅ 保存: {out}  ({len(re.sub(chr(92)+'s','',text)):,}字)")
    return out

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    fetch(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
