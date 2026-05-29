#!/usr/bin/env python3
"""
Gemini Nanobanana 2 で生産技術ガジェット研究所のロゴを3バリエーション自動生成。

成果物：
  blog/migration/logos/logo-A.png  (ミニマル)
  blog/migration/logos/logo-B.png  (テックフィーチャー)
  blog/migration/logos/logo-C.png  (バッジ風)
"""
from __future__ import annotations
import base64
import json
import time
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

CONFIG = json.loads(open("/Users/shoheikoda/Documents/my-ai-company/blog/config.json").read())
API_KEY = CONFIG['gemini_api_key']
MODEL = "gemini-2.5-flash-image"
ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"

OUT_DIR = Path("/Users/shoheikoda/Documents/my-ai-company/blog/migration/logos")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# 3バリエーション
PROMPTS = [
    {
        "label": "A-minimal",
        "filename": "logo-A-minimal.png",
        "prompt": (
            "Create a horizontal logo image for a Japanese tech blog called "
            "'生産技術ガジェット研究所' (Production Technology Gadget Laboratory, abbreviated PTGL). "
            "Minimal flat design. Aspect ratio 5:1 horizontal. "
            "Left side: an icon combining a gear and lightning bolt in deep blue (#1d4ed8). "
            "Right side: bold modern Japanese kanji '生産技術ガジェット研究所' in deep navy (#1e3a8a), "
            "and below it the small English subtitle 'PTGL - Production Technology Gadget Lab' in orange (#f97316). "
            "Pure white background. Clean, professional, modern, intellectual feel. "
            "High resolution 1600x400. No drop shadow, flat design only."
        )
    },
    {
        "label": "B-techfeature",
        "filename": "logo-B-techfeature.png",
        "prompt": (
            "Create a horizontal logo image for the Japanese tech blog '生産技術ガジェット研究所' (PTGL). "
            "Aspect ratio 5:1 horizontal. Tech-feature style with subtle circuit pattern decorations. "
            "Left side: a stylized icon of a microscope lens overlaid on circuit board lines, "
            "deep blue (#1d4ed8) and orange accent (#f97316). "
            "Right side: bold modern Japanese kanji '生産技術ガジェット研究所' in deep navy (#1e3a8a). "
            "Subtle hexagonal or grid pattern in light blue around the text. "
            "Pure white background. Professional, tech-savvy, innovative feel. "
            "High resolution 1600x400."
        )
    },
    {
        "label": "C-badge",
        "filename": "logo-C-badge.png",
        "prompt": (
            "Create a horizontal logo image for the Japanese tech blog '生産技術ガジェット研究所' (PTGL). "
            "Aspect ratio 5:1 horizontal. Badge/emblem style. "
            "Left side: a circular emblem badge containing a factory silhouette and an upward-trending data graph, "
            "deep blue (#1d4ed8) circle outline with orange (#f97316) graph accent. "
            "Right side: bold modern Japanese kanji '生産技術ガジェット研究所' in deep navy (#1e3a8a) "
            "and below it 'PTGL' in subtle orange. "
            "Pure white background. Trustworthy, established, professional feel. "
            "High resolution 1600x400."
        )
    },
]


def generate_one(prompt_item: dict) -> Path | None:
    print(f"\n[generate] {prompt_item['label']}: {prompt_item['filename']}")
    body = {
        "contents": [{"parts": [{"text": prompt_item['prompt']}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"]
        }
    }
    req = Request(ENDPOINT, data=json.dumps(body).encode(), method='POST',
                  headers={'Content-Type': 'application/json'})
    try:
        with urlopen(req, timeout=120) as r:
            resp = json.loads(r.read().decode())
    except HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')[:500]
        print(f"  ✗ HTTP {e.code}: {body}")
        return None

    # candidatesから画像のinlineDataを抽出
    candidates = resp.get('candidates', [])
    if not candidates:
        print(f"  ✗ no candidates")
        return None
    parts = candidates[0].get('content', {}).get('parts', [])
    img_part = None
    text_part = None
    for p in parts:
        if 'inlineData' in p or 'inline_data' in p:
            img_part = p.get('inlineData') or p.get('inline_data')
        elif 'text' in p:
            text_part = p['text']

    if not img_part:
        print(f"  ✗ no image part. text response: {text_part[:200] if text_part else 'none'}")
        return None

    mime = img_part.get('mimeType') or img_part.get('mime_type', 'image/png')
    data_b64 = img_part.get('data')
    if not data_b64:
        print(f"  ✗ no data field")
        return None

    img_bytes = base64.b64decode(data_b64)
    out_path = OUT_DIR / prompt_item['filename']
    out_path.write_bytes(img_bytes)
    print(f"  ✓ saved {len(img_bytes)} bytes → {out_path}")
    print(f"    mime={mime}")
    return out_path


def main():
    print(f"=== Gemini Nanobanana 2 でロゴ3バリエーション生成 ===")
    print(f"Output: {OUT_DIR}")

    results = []
    for p in PROMPTS:
        path = generate_one(p)
        if path:
            results.append({'label': p['label'], 'path': str(path), 'size': path.stat().st_size})
        time.sleep(2)  # rate limit

    summary_path = OUT_DIR / "generation-result.json"
    summary_path.write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(f"\n=== {len(results)}/{len(PROMPTS)} 件成功 ===")
    for r in results:
        print(f"  {r['label']}: {r['path']} ({r['size']} bytes)")


if __name__ == "__main__":
    main()
