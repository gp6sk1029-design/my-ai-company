"""
献立くん アプリアイコン生成スクリプト
- 緑系テーマ（#16a34a メイン）
- お椀＋湯気＋箸 のシンプルでPWAに映えるデザイン
- 各サイズの PNG と favicon.ico を出力

使い方: python3 tools/generate_icons.py
"""

from PIL import Image, ImageDraw, ImageFilter
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public')

# カラーパレット（CSSと揃える）
C_GREEN_DEEP = (21, 128, 61)      # #15803d
C_GREEN_MAIN = (22, 163, 74)      # #16a34a
C_GREEN_LIGHT = (34, 197, 94)     # #22c55e
C_WHITE = (255, 255, 255)
C_CREAM = (253, 248, 228)         # お椀の色
C_BROWN = (115, 82, 48)           # 箸の色
C_BROWN_DARK = (78, 54, 28)
C_STEAM = (255, 255, 255, 160)    # 湯気（半透明白）


def rounded_rect_mask(size, radius):
    """角丸マスクを作る"""
    mask = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def vertical_gradient(size, top_color, bottom_color):
    """上下のグラデーション画像"""
    grad = Image.new('RGB', (size, size), top_color)
    draw = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / max(1, size - 1)
        r = int(top_color[0] * (1 - t) + bottom_color[0] * t)
        g = int(top_color[1] * (1 - t) + bottom_color[1] * t)
        b = int(top_color[2] * (1 - t) + bottom_color[2] * t)
        draw.line([(0, y), (size, y)], fill=(r, g, b))
    return grad


def draw_icon(size, full_bleed=False):
    """
    献立アイコンを描画。
    - full_bleed=False: 通常。角丸背景で中央に料理アイコン
    - full_bleed=True: maskable 用。背景を全面塗り、料理を中央80%に配置
    """
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1) 背景（角丸グラデーション）
    radius = int(size * (0.02 if full_bleed else 0.22))
    bg = vertical_gradient(size, C_GREEN_LIGHT, C_GREEN_DEEP)
    bg_mask = rounded_rect_mask(size, radius)
    img.paste(bg, (0, 0), bg_mask)

    draw = ImageDraw.Draw(img)

    # 2) 湯気（3本の波線を上部に）
    #    お椀の上にふわっと立ち上がる3本の曲線
    steam_layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    steam_draw = ImageDraw.Draw(steam_layer)
    cx = size // 2
    steam_top = int(size * 0.18)
    steam_bot = int(size * 0.48)
    stem_w = max(2, int(size * 0.035))
    spacings = [-int(size * 0.14), 0, int(size * 0.14)]
    for sx_off in spacings:
        # 波線を多点ポリラインで。上→下にうねりながら
        pts = []
        for i in range(18):
            t = i / 17
            y = steam_top + (steam_bot - steam_top) * t
            # 左右にうねる sin 波
            import math
            wave = math.sin(t * math.pi * 2.2) * size * 0.035
            x = cx + sx_off + wave
            pts.append((x, y))
        steam_draw.line(pts, fill=(255, 255, 255, 170), width=stem_w)
    # 少しぼかして湯気らしく
    steam_layer = steam_layer.filter(ImageFilter.GaussianBlur(radius=max(1, size / 256)))
    img = Image.alpha_composite(img, steam_layer)
    draw = ImageDraw.Draw(img)

    # 3) 箸（お椀の手前右側に斜めに2本）
    chop_layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    chop_draw = ImageDraw.Draw(chop_layer)
    chop_w = max(3, int(size * 0.045))
    # 箸1本目
    chop_draw.line(
        [(size * 0.74, size * 0.28), (size * 0.46, size * 0.74)],
        fill=C_BROWN, width=chop_w,
    )
    # 箸2本目（少しずらして平行に）
    chop_draw.line(
        [(size * 0.82, size * 0.33), (size * 0.54, size * 0.79)],
        fill=C_BROWN_DARK, width=chop_w,
    )
    img = Image.alpha_composite(img, chop_layer)
    draw = ImageDraw.Draw(img)

    # 4) お椀（楕円の下半分に近い形）
    bowl_w = int(size * 0.68)
    bowl_h = int(size * 0.40)
    bowl_cx = size // 2
    bowl_cy = int(size * 0.66)

    # お椀の上縁（楕円を横に）
    rim_top = bowl_cy - bowl_h // 2 - int(size * 0.02)
    rim_bot = bowl_cy - bowl_h // 2 + int(size * 0.04)
    # お椀の本体（下半分の楕円）
    bowl_box = [
        bowl_cx - bowl_w // 2,
        bowl_cy - bowl_h // 2,
        bowl_cx + bowl_w // 2,
        bowl_cy + bowl_h // 2,
    ]
    # お椀の本体をクリーム色で描画
    draw.ellipse(bowl_box, fill=C_CREAM)
    # 上半分をカットして「お椀の器」感を出す
    # →楕円そのままだと器っぽく見えるので、ぐっと緑の上縁を加える
    # 縁（料理の色・緑茶 or 味噌汁感でブラウン系に）
    rim_color = (200, 158, 90)  # 縁の色
    draw.ellipse(
        [bowl_cx - bowl_w // 2, rim_top, bowl_cx + bowl_w // 2, rim_bot + int(size * 0.04)],
        fill=rim_color,
    )
    # 中の料理（小さい濃茶の楕円）＝ご飯・煮物のイメージ
    inner_w = int(bowl_w * 0.78)
    inner_h = int(size * 0.06)
    inner_cy = rim_top + int(size * 0.03)
    draw.ellipse(
        [bowl_cx - inner_w // 2, inner_cy - inner_h // 2,
         bowl_cx + inner_w // 2, inner_cy + inner_h // 2],
        fill=(245, 232, 195),
    )

    # 5) お椀のハイライト（左上に薄い白）
    hl = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    hl_draw = ImageDraw.Draw(hl)
    hl_draw.ellipse(
        [bowl_cx - int(bowl_w * 0.42), bowl_cy - int(bowl_h * 0.12),
         bowl_cx - int(bowl_w * 0.10), bowl_cy + int(bowl_h * 0.08)],
        fill=(255, 255, 255, 60),
    )
    hl = hl.filter(ImageFilter.GaussianBlur(radius=max(1, size / 128)))
    img = Image.alpha_composite(img, hl)

    # 6) 影（お椀の下にうっすら）
    shadow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sh_y = bowl_cy + bowl_h // 2 + int(size * 0.02)
    sd.ellipse(
        [bowl_cx - int(bowl_w * 0.38), sh_y - int(size * 0.012),
         bowl_cx + int(bowl_w * 0.38), sh_y + int(size * 0.025)],
        fill=(0, 0, 0, 50),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=max(1, size / 96)))
    img = Image.alpha_composite(img, shadow)

    return img


def save_all():
    sizes = {
        'icon-512.png': 512,
        'icon-192.png': 192,
        'apple-touch-icon.png': 180,
        'favicon-64.png': 64,
        'favicon-32.png': 32,
    }
    for filename, s in sizes.items():
        img = draw_icon(s, full_bleed=(s >= 192))
        out = os.path.join(OUT_DIR, filename)
        img.save(out, 'PNG', optimize=True)
        print(f'  -> {out} ({s}x{s})')

    # favicon.ico (32x32 と 16x16 を含む)
    ico_base = draw_icon(32)
    ico_small = draw_icon(16)
    ico_path = os.path.join(OUT_DIR, 'favicon.ico')
    ico_base.save(ico_path, format='ICO', sizes=[(16, 16), (32, 32)], append_images=[ico_small])
    print(f'  -> {ico_path}')


if __name__ == '__main__':
    print('献立くんアイコン生成中...')
    save_all()
    print('完了')
