#!/usr/bin/env python3
"""
PTGLロゴ v2 - テキスト中心のクリーン・モダンデザイン

レイアウト:
  [PTGL] 生産技術ガジェット研究所
         Production Technology Gadget Lab

成果物: blog/migration/logos/ptgl-header-logo-v2.png
"""
from __future__ import annotations
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path("/Users/shoheikoda/Documents/my-ai-company/blog/migration/logos")

W, H = 1600, 320
PRIMARY = (29, 78, 216)        # #1d4ed8
PRIMARY_DARK = (30, 58, 138)   # #1e3a8a
ACCENT = (249, 115, 22)        # #f97316
TEXT = (31, 41, 55)            # #1f2937


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
        ("/Library/Fonts/Arial Bold.ttf", 0),
    ]
    for p, idx in candidates:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size, index=idx)
            except Exception:
                continue
    return ImageFont.load_default()


def draw_ptgl_badge(canvas: Image.Image, x: int, y: int, size: int):
    """[PTGL] バッジを描画（角丸正方形＋中にPTGLテキスト）"""
    draw = ImageDraw.Draw(canvas)

    # 角丸正方形（深い青）
    radius = int(size * 0.18)
    bbox = [x, y, x + size, y + size]
    draw.rounded_rectangle(bbox, radius=radius, fill=PRIMARY)

    # 内側にギアマーク（オレンジ・小さい）
    cx = x + size // 2
    cy = y + size // 2 - int(size * 0.10)
    gear_r = int(size * 0.18)
    teeth = 8
    inner_r = int(gear_r * 0.7)
    gear_pts = []
    for i in range(teeth * 2):
        angle = (i * math.pi / teeth) - math.pi / 2
        r = gear_r if i % 2 == 0 else inner_r
        gear_pts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    draw.polygon(gear_pts, fill=ACCENT)
    # 中心穴（青）
    hole_r = int(gear_r * 0.30)
    draw.ellipse([cx - hole_r, cy - hole_r, cx + hole_r, cy + hole_r], fill=PRIMARY)

    # PTGLテキスト
    txt_font = find_en_font(int(size * 0.24), bold=True)
    txt = "PTGL"
    bb = draw.textbbox((0, 0), txt, font=txt_font)
    tw = bb[2] - bb[0]
    th = bb[3] - bb[1]
    draw.text(
        (cx - tw // 2, y + size - th - int(size * 0.18)),
        txt, fill=(255, 255, 255), font=txt_font
    )


def draw_accent_line(canvas: Image.Image, x: int, y: int, length: int, height: int):
    """アクセントライン（オレンジ・細いバー）"""
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle([x, y, x + length, y + height], radius=height // 2, fill=ACCENT)


def main():
    canvas = Image.new('RGBA', (W, H), (255, 255, 255, 0))  # 透過背景
    draw = ImageDraw.Draw(canvas)

    # 1) [PTGL] バッジ（左）
    badge_size = 220
    badge_x = 60
    badge_y = (H - badge_size) // 2
    draw_ptgl_badge(canvas, badge_x, badge_y, badge_size)

    # 2) アクセントライン（バッジの右に縦の細いバー）
    draw_accent_line(canvas, badge_x + badge_size + 32, 80, 8, H - 160)

    # 3) 日本語タイトル
    text_x = badge_x + badge_size + 64
    jp_font = find_jp_font(82)
    jp_text = "生産技術ガジェット研究所"
    jp_bbox = draw.textbbox((0, 0), jp_text, font=jp_font)
    jp_h = jp_bbox[3] - jp_bbox[1]
    jp_y = (H - jp_h) // 2 - 30
    draw.text((text_x, jp_y), jp_text, fill=PRIMARY_DARK, font=jp_font)

    # 4) 英語サブタイトル（大きめ・Bold）
    en_font = find_en_font(28, bold=True)
    en_text = "PRODUCTION TECHNOLOGY GADGET LAB"
    en_y = jp_y + jp_h + 18
    draw.text((text_x, en_y), en_text, fill=ACCENT, font=en_font)

    # 余白を考慮した最終調整：アイコンとテキストの位置確認
    # 必要なら横幅をクロップ（不要な空白を除去）
    bbox_total = canvas.getbbox()
    if bbox_total:
        # 余白24pxマージン付きで自動クロップ（左右のみ）
        margin = 32
        canvas = canvas.crop((max(0, bbox_total[0] - margin), 0,
                              min(W, bbox_total[2] + margin), H))

    # 透過版保存
    out_t = OUT_DIR / "ptgl-header-logo-v2.png"
    canvas.save(out_t, format='PNG', optimize=True)
    print(f"✓ {out_t} ({out_t.stat().st_size} bytes, {canvas.size})")

    # 白背景版（ヘッダー幅にぴったりフィット）
    canvas_w = Image.new('RGB', canvas.size, (255, 255, 255))
    canvas_w.paste(canvas, mask=canvas.split()[3])
    out_w = OUT_DIR / "ptgl-header-logo-v2-white.png"
    canvas_w.save(out_w, format='PNG', optimize=True)
    print(f"✓ {out_w} ({out_w.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
