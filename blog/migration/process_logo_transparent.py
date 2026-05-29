#!/usr/bin/env python3
"""
ChatGPT生成ロゴから白背景を除去し透過PNG化＋自動トリミング
1. 白っぽい（>=240）ピクセルのαを0に
2. 不透明領域でクロップ（左右上下）
3. ヘッダー用に幅1200にリサイズ（アスペクト維持）
4. PNG最適化保存
"""
from pathlib import Path
from PIL import Image
import numpy as np

SRC = Path("/Users/shoheikoda/Documents/my-ai-company/blog/migration/logos/ptgl-logo-chatgpt-final.png")
OUT_DIR = Path("/Users/shoheikoda/Documents/my-ai-company/blog/migration/logos")
OUT = OUT_DIR / "ptgl-logo-transparent.png"

THRESHOLD = 235  # この値以上の各RGB成分を白とみなして透過
SOFT_BAND = 20   # ボーダー部の半透過処理用バンド

def main():
    img = Image.open(SRC).convert("RGBA")
    arr = np.array(img)  # shape (H, W, 4)
    print(f"入力: {img.size}, mode=RGBA")

    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
    # 各ピクセルの「白さ」= min(r,g,b)
    minrgb = np.minimum(np.minimum(r, g), b)

    # 完全白 (>=THRESHOLD): α=0
    mask_clear = minrgb >= THRESHOLD
    # 半透過バンド (THRESHOLD-SOFT_BAND ~ THRESHOLD)
    mask_soft = (minrgb >= THRESHOLD - SOFT_BAND) & ~mask_clear

    new_a = a.astype(np.int32)
    new_a[mask_clear] = 0
    # ソフトバンドはグラデで0→255に
    band_val = ((THRESHOLD - minrgb[mask_soft]).astype(np.float32) / SOFT_BAND * 255).clip(0, 255)
    new_a[mask_soft] = band_val.astype(np.int32)
    new_a = new_a.clip(0, 255).astype(np.uint8)

    arr[..., 3] = new_a
    out = Image.fromarray(arr, "RGBA")

    # 不透明領域でクロップ
    bbox = out.getbbox()
    if bbox:
        # 余白マージン少し残す
        margin = 10
        L = max(0, bbox[0] - margin)
        T = max(0, bbox[1] - margin)
        R = min(out.width, bbox[2] + margin)
        B = min(out.height, bbox[3] + margin)
        out = out.crop((L, T, R, B))
        print(f"クロップ後: {out.size}")

    # ヘッダー用にリサイズ（幅1200・WAF回避）
    target_w = 1200
    if out.width > target_w:
        ratio = target_w / out.width
        new_h = int(out.height * ratio)
        out = out.resize((target_w, new_h), Image.LANCZOS)
        print(f"リサイズ後: {out.size}")

    out.save(OUT, format="PNG", optimize=True)
    size_kb = OUT.stat().st_size / 1024
    print(f"✓ 保存: {OUT}  ({size_kb:.1f} KB, {out.size})")

if __name__ == "__main__":
    main()
