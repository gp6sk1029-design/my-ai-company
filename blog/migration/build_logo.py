#!/usr/bin/env python3
"""
Pillow + cairosvg で高品質なPTGLヘッダーロゴをプログラム生成。

成果物: blog/migration/logos/ptgl-header-logo.png（1600×320 透過PNG）

使い方:
  python3 blog/migration/build_logo.py
"""
from __future__ import annotations
import io
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path("/Users/shoheikoda/Documents/my-ai-company/blog/migration/logos")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# キャンバス
W, H = 1600, 320
PRIMARY = (29, 78, 216)        # #1d4ed8
PRIMARY_DARK = (30, 58, 138)   # #1e3a8a
ACCENT = (249, 115, 22)        # #f97316


def find_japanese_font(size: int) -> ImageFont.FreeTypeFont:
    """システム上の日本語フォントを探す（Heavy/Black 優先）"""
    candidates = [
        "/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc",
        "/System/Library/Fonts/ヒラギノ角ゴシック W7.ttc",
        "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
        "/System/Library/Fonts/ヒラギノ角ゴ ProN W6.otf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/PingFang.ttc",
    ]
    for p in candidates:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def find_english_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """英語用フォント"""
    if bold:
        candidates = [
            "/System/Library/Fonts/Helvetica.ttc",
            "/Library/Fonts/Arial Bold.ttf",
        ]
    else:
        candidates = [
            "/System/Library/Fonts/Helvetica.ttc",
            "/Library/Fonts/Arial.ttf",
        ]
    for p in candidates:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size, index=1 if bold else 0)
            except Exception:
                continue
    return ImageFont.load_default()


def draw_gear_lightning_icon(canvas: Image.Image, cx: int, cy: int, size: int):
    """ギア+稲妻アイコンを描画"""
    draw = ImageDraw.Draw(canvas)

    # ギア（外周12歯）
    import math
    teeth = 12
    outer_r = size // 2
    inner_r = int(outer_r * 0.85)
    tooth_h = int(outer_r * 0.18)

    # ギアの円形ベース
    # 外接多角形で歯を表現
    gear_pts = []
    for i in range(teeth * 2):
        angle = (i * math.pi / teeth) - math.pi / 2
        r = outer_r if i % 2 == 0 else inner_r
        x = cx + r * math.cos(angle)
        y = cy + r * math.sin(angle)
        gear_pts.append((x, y))
    draw.polygon(gear_pts, fill=PRIMARY)

    # 中心の穴（白）
    hole_r = int(outer_r * 0.40)
    draw.ellipse(
        [cx - hole_r, cy - hole_r, cx + hole_r, cy + hole_r],
        fill=(255, 255, 255, 0)  # 透過
    )

    # 稲妻（ギアの中心に重ねる・オレンジ）
    bolt_w = int(size * 0.32)
    bolt_h = int(size * 0.45)
    bx = cx
    by = cy
    bolt_pts = [
        (bx - bolt_w // 4, by - bolt_h // 2),       # 上
        (bx + bolt_w // 6, by - bolt_h // 8),
        (bx - bolt_w // 8, by - bolt_h // 8),
        (bx + bolt_w // 4, by + bolt_h // 2),       # 下
        (bx - bolt_w // 6, by + bolt_h // 10),
        (bx + bolt_w // 8, by + bolt_h // 10),
    ]
    draw.polygon(bolt_pts, fill=ACCENT)


def main():
    # 透過PNGキャンバス
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    # アイコン領域（左 240px 中央）
    icon_size = 200
    icon_cx = 140
    icon_cy = H // 2

    # 中心の穴を「ホール」として表現するため、別画像に描いてから合成
    icon_layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw_gear_lightning_icon(icon_layer, icon_cx, icon_cy, icon_size)
    canvas = Image.alpha_composite(canvas, icon_layer)

    # ホールを開ける（パンチ）
    draw = ImageDraw.Draw(canvas)
    hole_r = int(icon_size * 0.20)
    # 穴を白塗りすると透過にならない。alphaで穴を切り抜く（ImageDraw単体では難しい）
    # 代わりに穴部分を描かない方法を取るが、複雑なのでここではホールなしで運用

    # 日本語タイトル
    jp_font = find_japanese_font(64)
    jp_text = "生産技術ガジェット研究所"
    jp_y = 80
    jp_x = 280
    draw.text((jp_x, jp_y), jp_text, fill=PRIMARY_DARK, font=jp_font)

    # 英語サブタイトル
    en_font = find_english_font(22, bold=False)
    en_text = "PTGL — Production Technology Gadget Lab"
    en_y = jp_y + 90
    draw.text((jp_x, en_y), en_text, fill=ACCENT, font=en_font)

    # 装飾：右側にうっすら回路パターン（点線）
    deco_color = (29, 78, 216, 30)  # 透過ブルー
    pattern_layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    pattern_draw = ImageDraw.Draw(pattern_layer)
    for x in range(1100, W, 24):
        for y in range(40, H - 40, 24):
            pattern_draw.ellipse([x - 2, y - 2, x + 2, y + 2], fill=deco_color)
    canvas = Image.alpha_composite(canvas, pattern_layer)

    # 保存（透過PNG）
    out = OUT_DIR / "ptgl-header-logo.png"
    canvas.save(out, format='PNG', optimize=True)
    print(f"✓ saved {out} ({out.stat().st_size} bytes, {W}x{H})")

    # 白背景バージョンも保存（JIN:Rヘッダー用）
    canvas_white = Image.new('RGB', (W, H), (255, 255, 255))
    canvas_white.paste(canvas, mask=canvas.split()[3])
    out_white = OUT_DIR / "ptgl-header-logo-white.png"
    canvas_white.save(out_white, format='PNG', optimize=True)
    print(f"✓ saved {out_white} ({out_white.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
