#!/usr/bin/env python3
"""
PTGLロゴ v5 - ヘッダー専用スリム比率（8:1）
画像比率自体を横長スリムにして、ヘッダー内で日本語が読めるサイズに表示される設計

サイズ: 1600 x 200（8:1）
"""
from __future__ import annotations
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageChops

OUT_DIR = Path("/Users/shoheikoda/Documents/my-ai-company/blog/migration/logos")

W, H = 1600, 200
PRIMARY = (29, 78, 216)
PRIMARY_DARK = (30, 58, 138)
ACCENT = (249, 115, 22)


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


def draw_gear(canvas: Image.Image, cx: int, cy: int, size: int):
    SCALE = 4
    big_w = size * SCALE
    big = Image.new('RGBA', (big_w + SCALE * 8, big_w + SCALE * 8), (0, 0, 0, 0))
    bd = ImageDraw.Draw(big)
    bcx = big_w // 2 + SCALE * 4
    bcy = big_w // 2 + SCALE * 4

    teeth = 14
    outer_r = (big_w // 2) - SCALE * 2
    inner_r = int(outer_r * 0.86)
    pts = []
    for i in range(teeth * 2):
        angle_step = math.pi / teeth
        a = i * angle_step - math.pi / 2
        if i % 2 == 0:
            tw = angle_step * 0.45
            for da in [-tw, tw]:
                pts.append((bcx + outer_r * math.cos(a + da),
                            bcy + outer_r * math.sin(a + da)))
        else:
            vw = angle_step * 0.45
            for da in [-vw, vw]:
                pts.append((bcx + inner_r * math.cos(a + da),
                            bcy + inner_r * math.sin(a + da)))
    bd.polygon(pts, fill=PRIMARY)

    # 中央穴
    hole_r = int(outer_r * 0.45)
    mask = Image.new('L', big.size, 255)
    md = ImageDraw.Draw(mask)
    md.ellipse([bcx - hole_r, bcy - hole_r, bcx + hole_r, bcy + hole_r], fill=0)
    r, g, b, a = big.split()
    a2 = ImageChops.multiply(a, mask)
    big = Image.merge('RGBA', (r, g, b, a2))

    final = big.resize((size + 8, size + 8), Image.LANCZOS)

    # 稲妻
    fd = ImageDraw.Draw(final)
    fcx, fcy = (size + 8) // 2, (size + 8) // 2
    bw = int(size * 0.30)
    bh = int(size * 0.55)
    bolt = [
        (fcx + bw // 6, fcy - bh // 2),
        (fcx - bw // 4, fcy + bh // 12),
        (fcx + bw // 12, fcy + bh // 12),
        (fcx - bw // 6, fcy + bh // 2),
        (fcx + bw // 4, fcy - bh // 12),
        (fcx - bw // 12, fcy - bh // 12),
    ]
    fd.polygon(bolt, fill=ACCENT)
    canvas.paste(final, (cx - (size + 8) // 2, cy - (size + 8) // 2), final)


def main():
    canvas = Image.new('RGBA', (W, H), (255, 255, 255, 0))
    draw = ImageDraw.Draw(canvas)

    # 左にギア
    icon_size = 140
    icon_cx = 100
    icon_cy = H // 2
    draw_gear(canvas, icon_cx, icon_cy, icon_size)

    # 右にテキスト
    text_x = icon_cx + icon_size // 2 + 32

    # 日本語タイトル（H=200, 1行に収まるサイズに調整）
    jp_font = find_jp_font(82)
    jp_text = "生産技術ガジェット研究所"
    jp_bbox = draw.textbbox((0, 0), jp_text, font=jp_font)
    jp_h = jp_bbox[3] - jp_bbox[1]
    jp_y = (H - jp_h) // 2 - 22
    draw.text((text_x, jp_y), jp_text, fill=PRIMARY_DARK, font=jp_font)

    # 英語サブタイトル
    en_font = find_en_font(26, bold=True)
    en_text = "PTGL  —  PRODUCTION TECHNOLOGY GADGET LAB"
    en_y = jp_y + jp_h + 8
    draw.text((text_x, en_y), en_text, fill=ACCENT, font=en_font)

    # クロップ
    bbox = canvas.getbbox()
    if bbox:
        margin = 24
        canvas = canvas.crop((max(0, bbox[0] - margin), 0,
                              min(W, bbox[2] + margin), H))

    out_t = OUT_DIR / "ptgl-header-logo-v5.png"
    canvas.save(out_t, format='PNG', optimize=True)
    print(f"✓ {out_t} ({out_t.stat().st_size} bytes, {canvas.size})")

    canvas_w = Image.new('RGB', canvas.size, (255, 255, 255))
    canvas_w.paste(canvas, mask=canvas.split()[3])
    out_w = OUT_DIR / "ptgl-header-logo-v5-white.png"
    canvas_w.save(out_w, format='PNG', optimize=True)
    print(f"✓ {out_w} ({out_w.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
