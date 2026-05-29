#!/usr/bin/env python3
"""
画像リサイズユーティリティ

Claude APIの制約「多数画像モードで各画像は2000px以下」を守るため、
ブログ用画像を自動で2000px以下にリサイズする。

使い方：
  # 単一ファイル
  python image_resizer.py path/to/image.jpg

  # フォルダ内を一括処理（サブフォルダも）
  python image_resizer.py blog/images/

  # 上限px変更（デフォルト1800）
  python image_resizer.py path/to/image.jpg --max 1600

動作：
- 長辺が上限超えの画像のみ処理（それ以外はスキップ）
- 元ファイルを上書き（--backup指定で .bak バックアップ）
- 縦横比は保持
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("❌ Pillow 未インストール。インストール: pip install Pillow", file=sys.stderr)
    sys.exit(1)


# 2000px制限に対して安全マージン200pxを確保
DEFAULT_MAX = 1800
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def resize_if_needed(path: Path, max_size: int, backup: bool) -> str:
    """画像をチェックし、必要ならリサイズ。戻り値は結果文字列。"""
    try:
        with Image.open(path) as img:
            w, h = img.size
            long_side = max(w, h)

            if long_side <= max_size:
                return f"SKIP  ({w}x{h}): {path.name}"

            # アスペクト比保持でリサイズ
            ratio = max_size / long_side
            new_w = int(w * ratio)
            new_h = int(h * ratio)

            if backup:
                backup_path = path.with_suffix(path.suffix + ".bak")
                path.rename(backup_path)
                src = backup_path
            else:
                src = path

            with Image.open(src) as orig:
                resized = orig.resize((new_w, new_h), Image.LANCZOS)
                # JPEGは品質90で保存、PNGはそのまま
                if path.suffix.lower() in {".jpg", ".jpeg"}:
                    resized.convert("RGB").save(path, "JPEG", quality=90, optimize=True)
                else:
                    resized.save(path, optimize=True)

            return f"RESIZE {w}x{h} → {new_w}x{new_h}: {path.name}"

    except Exception as e:
        return f"ERROR {path.name}: {e}"


def collect_images(target: Path) -> list[Path]:
    """対象パスから画像ファイルを収集。"""
    if target.is_file():
        return [target] if target.suffix.lower() in IMAGE_EXTENSIONS else []
    if target.is_dir():
        return [
            p for p in target.rglob("*")
            if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
        ]
    return []


def main() -> int:
    parser = argparse.ArgumentParser(description="画像を2000px以下にリサイズ")
    parser.add_argument("target", type=Path, help="ファイルまたはフォルダのパス")
    parser.add_argument("--max", type=int, default=DEFAULT_MAX,
                        help=f"長辺の上限px（デフォルト: {DEFAULT_MAX}）")
    parser.add_argument("--backup", action="store_true",
                        help="元ファイルを.bakとして残す")
    args = parser.parse_args()

    if not args.target.exists():
        print(f"❌ パスが存在しません: {args.target}", file=sys.stderr)
        return 1

    images = collect_images(args.target)
    if not images:
        print(f"画像ファイルが見つかりません: {args.target}")
        return 0

    print(f"🔍 対象: {len(images)}枚 | 上限: {args.max}px | バックアップ: {args.backup}")
    print("-" * 60)

    resized_count = 0
    for img_path in images:
        result = resize_if_needed(img_path, args.max, args.backup)
        print(result)
        if result.startswith("RESIZE"):
            resized_count += 1

    print("-" * 60)
    print(f"✅ 完了: {resized_count}枚リサイズ / {len(images) - resized_count}枚スキップ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
