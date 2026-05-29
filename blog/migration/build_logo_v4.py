#!/usr/bin/env python3
"""
PTGLロゴ v4 - ChatGPT風アイコン入り（円形ギア＋稲妻＋日本語タイトル）

ChatGPT生成版（オーナーの好み確認済み）の構図をPillowで再現：
- 左：円形にぎっしり詰まったギア（ブルー）+ 中央に稲妻（オレンジ）
- 右：太字「生産技術ガジェット研究所」（濃紺）
- 下：「PTGL — Production Technology Gadget Lab」（オレンジ）
"""
from __future__ import annotations
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT_DIR = Path("/Users/shoheikoda/Documents/my-ai-company/blog/migration/logos")

W, H = 1916, 480
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


def draw_proper_gear(img: Image.Image, cx: int, cy: int, size: int):
    """しっかりした歯車（外周12歯・中央穴付き）を高解像度で描画"""
    SCALE = 4  # アンチエイリアス用に4倍解像度で描いて縮小
    big_size = size * SCALE
    big = Image.new('RGBA', (big_size + SCALE * 8, big_size + SCALE * 8), (0, 0, 0, 0))
    bd = ImageDraw.Draw(big)
    bcx, bcy = big_size // 2 + SCALE * 4, big_size // 2 + SCALE * 4

    teeth = 14
    outer_r = (big_size // 2) - SCALE * 2
    inner_r = int(outer_r * 0.86)

    # 歯車外周（外接トゥース・全ての歯）
    pts = []
    for i in range(teeth * 2):
        # 各歯はトラペゾイド形に。歯の幅角度を計算
        angle_step = math.pi / teeth
        a_center = i * angle_step - math.pi / 2
        if i % 2 == 0:
            # 外側（歯の先端 - 2点で平らな歯先）
            tw = angle_step * 0.45  # 歯の半角
            for da in [-tw, tw]:
                pts.append((bcx + outer_r * math.cos(a_center + da),
                            bcy + outer_r * math.sin(a_center + da)))
        else:
            # 内側（谷 - 2点）
            vw = angle_step * 0.45
            for da in [-vw, vw]:
                pts.append((bcx + inner_r * math.cos(a_center + da),
                            bcy + inner_r * math.sin(a_center + da)))

    bd.polygon(pts, fill=PRIMARY)

    # 中央の穴（透過）→ 別レイヤーでmask
    hole_r = int(outer_r * 0.45)
    mask = Image.new('L', big.size, 255)
    md = ImageDraw.Draw(mask)
    md.ellipse([bcx - hole_r, bcy - hole_r, bcx + hole_r, bcy + hole_r], fill=0)

    # アルファチャネル合成（hole部分を透過に）
    r, g, b, a = big.split()
    new_a = Image.eval(a, lambda x: x).point(lambda x: x)
    # maskを乗じてholeを透過
    from PIL import ImageChops
    new_a = ImageChops.multiply(new_a, mask)
    big = Image.merge('RGBA', (r, g, b, new_a))

    # アンチエイリアス縮小
    final = big.resize((size + 8, size + 8), Image.LANCZOS)

    # 中央に稲妻（オレンジ）を描画 - 縮小後の画像に重ねる
    fd = ImageDraw.Draw(final)
    fcx, fcy = (size + 8) // 2, (size + 8) // 2
    bolt_w = int(size * 0.30)
    bolt_h = int(size * 0.55)
    bolt_pts = [
        (fcx + bolt_w // 6, fcy - bolt_h // 2),       # 上右
        (fcx - bolt_w // 4, fcy + bolt_h // 12),       # 中左
        (fcx + bolt_w // 12, fcy + bolt_h // 12),      # 中右
        (fcx - bolt_w // 6, fcy + bolt_h // 2),       # 下左
        (fcx + bolt_w // 4, fcy - bolt_h // 12),       # 中右上
        (fcx - bolt_w // 12, fcy - bolt_h // 12),      # 中左上
    ]
    fd.polygon(bolt_pts, fill=ACCENT)

    # キャンバスに貼り付け
    img.paste(final, (cx - (size + 8) // 2, cy - (size + 8) // 2), final)


def main():
    canvas = Image.new('RGBA', (W, H), (255, 255, 255, 0))
    draw = ImageDraw.Draw(canvas)

    # 左にギアアイコン
    icon_size = 320
    icon_cx = 240
    icon_cy = H // 2
    draw_proper_gear(canvas, icon_cx, icon_cy, icon_size)

    # 右テキスト領域
    text_x = icon_cx + icon_size // 2 + 60

    # 日本語タイトル
    jp_font = find_jp_font(120)
    jp_text = "生産技術ガジェット研究所"
    jp_bbox = draw.textbbox((0, 0), jp_text, font=jp_font)
    jp_h = jp_bbox[3] - jp_bbox[1]
    jp_y = (H - jp_h) // 2 - 40
    draw.text((text_x, jp_y), jp_text, fill=PRIMARY_DARK, font=jp_font)

    # 英語サブタイトル
    en_font = find_en_font(40, bold=True)
    en_text = "PTGL  —  PRODUCTION TECHNOLOGY GADGET LAB"
    en_y = jp_y + jp_h + 20
    draw.text((text_x, en_y), en_text, fill=ACCENT, font=en_font)

    # クロップで余白除去
    bbox = canvas.getbbox()
    if bbox:
        margin = 40
        canvas = canvas.crop((max(0, bbox[0] - margin), 0,
                              min(W, bbox[2] + margin), H))

    out_t = OUT_DIR / "ptgl-header-logo-v4.png"
    canvas.save(out_t, format='PNG', optimize=True)
    print(f"✓ {out_t} ({out_t.stat().st_size} bytes, {canvas.size})")

    canvas_w = Image.new('RGB', canvas.size, (255, 255, 255))
    canvas_w.paste(canvas, mask=canvas.split()[3])
    out_w = OUT_DIR / "ptgl-header-logo-v4-white.png"
    canvas_w.save(out_w, format='PNG', optimize=True)
    print(f"✓ {out_w} ({out_w.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
