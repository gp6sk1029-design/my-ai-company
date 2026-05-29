#!/usr/bin/env python3
"""
PTGLロゴ v3 - 完全テキスト中心のクリーンなタイポグラフィロゴ
（アイコンの問題を解決するため、テキストのみで構成）

レイアウト:
  ━━ 生産技術ガジェット研究所 ━━
     PTGL · Production Technology Gadget Lab
"""
from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path("/Users/shoheikoda/Documents/my-ai-company/blog/migration/logos")

W, H = 1600, 320
PRIMARY = (29, 78, 216)        # #1d4ed8
PRIMARY_DARK = (30, 58, 138)   # #1e3a8a
ACCENT = (249, 115, 22)        # #f97316


def find_jp_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        ("/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc", 0),
        ("/System/Library/Fonts/ヒラギノ角ゴシック W7.ttc", 0),
        ("/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc", 0),
    ]
    for p, idx in candidates:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size, index=idx)
            except Exception:
                continue
    return ImageFont.load_default()


def find_en_font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    candidates = [
        ("/System/Library/Fonts/HelveticaNeue.ttc", 1 if bold else 0),
        ("/System/Library/Fonts/Helvetica.ttc", 1 if bold else 0),
    ]
    for p, idx in candidates:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size, index=idx)
            except Exception:
                continue
    return ImageFont.load_default()


def main():
    canvas = Image.new('RGBA', (W, H), (255, 255, 255, 0))
    draw = ImageDraw.Draw(canvas)

    # 仕様：テキスト中心・水平アクセントライン2本でフレーム

    # 日本語タイトル（中心）
    jp_font = find_jp_font(96)
    jp_text = "生産技術ガジェット研究所"
    jp_bbox = draw.textbbox((0, 0), jp_text, font=jp_font)
    jp_w = jp_bbox[2] - jp_bbox[0]
    jp_h = jp_bbox[3] - jp_bbox[1]
    jp_x = (W - jp_w) // 2
    jp_y = 80

    # 英語サブタイトル
    en_font = find_en_font(34, bold=True)
    en_text = "PTGL  ·  PRODUCTION TECHNOLOGY GADGET LAB"
    en_bbox = draw.textbbox((0, 0), en_text, font=en_font)
    en_w = en_bbox[2] - en_bbox[0]
    en_h = en_bbox[3] - en_bbox[1]
    en_x = (W - en_w) // 2
    en_y = jp_y + jp_h + 30

    # アクセントライン（タイトル左右にオレンジの装飾線）
    line_h = 4
    line_pad = 30
    line_len = 80

    # 左ライン
    line_y = jp_y + jp_h // 2
    draw.rounded_rectangle(
        [jp_x - line_pad - line_len, line_y - line_h // 2,
         jp_x - line_pad, line_y + line_h // 2],
        radius=line_h // 2, fill=ACCENT
    )
    # 右ライン
    draw.rounded_rectangle(
        [jp_x + jp_w + line_pad, line_y - line_h // 2,
         jp_x + jp_w + line_pad + line_len, line_y + line_h // 2],
        radius=line_h // 2, fill=ACCENT
    )

    # タイトル描画
    draw.text((jp_x, jp_y), jp_text, fill=PRIMARY_DARK, font=jp_font)
    draw.text((en_x, en_y), en_text, fill=ACCENT, font=en_font)

    # 上部にミニアクセント（ブルーの極小ドット3つ）
    cx = W // 2
    dot_y = 38
    for offset in [-24, 0, 24]:
        draw.ellipse([cx + offset - 4, dot_y - 4, cx + offset + 4, dot_y + 4],
                     fill=PRIMARY)

    # クロップで余白除去
    bbox = canvas.getbbox()
    if bbox:
        margin = 40
        canvas = canvas.crop((max(0, bbox[0] - margin), 0,
                              min(W, bbox[2] + margin), H))

    out_t = OUT_DIR / "ptgl-header-logo-v3.png"
    canvas.save(out_t, format='PNG', optimize=True)
    print(f"✓ {out_t} ({out_t.stat().st_size} bytes, {canvas.size})")

    # 白背景版
    canvas_w = Image.new('RGB', canvas.size, (255, 255, 255))
    canvas_w.paste(canvas, mask=canvas.split()[3])
    out_w = OUT_DIR / "ptgl-header-logo-v3-white.png"
    canvas_w.save(out_w, format='PNG', optimize=True)
    print(f"✓ {out_w} ({out_w.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
