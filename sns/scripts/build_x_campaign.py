#!/usr/bin/env python3
"""X拡散セット（投稿文＋最大4枚の図解PNG）をJSON仕様から生成する。"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont


ROOT = Path(__file__).resolve().parents[2]


def _font_path(bold: bool) -> str:
    candidates = [
        "/System/Library/Fonts/ヒラギノ角ゴシック W9.ttc" if bold else "/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    raise FileNotFoundError("日本語フォントが見つかりません")


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(_font_path(bold), size=size)


def rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def resolve_path(raw: str, spec_dir: Path) -> Path:
    p = Path(raw).expanduser()
    if p.is_absolute():
        return p
    for base in (spec_dir, ROOT):
        candidate = (base / p).resolve()
        if candidate.exists():
            return candidate
    return (spec_dir / p).resolve()


def cover_photo(path: Path, size: tuple[int, int], focus: tuple[float, float] = (0.5, 0.5)) -> Image.Image:
    image = Image.open(path).convert("RGB")
    target_w, target_h = size
    scale = max(target_w / image.width, target_h / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    fx, fy = focus
    left = round((resized.width - target_w) * fx)
    top = round((resized.height - target_h) * fy)
    left = max(0, min(left, resized.width - target_w))
    top = max(0, min(top, resized.height - target_h))
    return resized.crop((left, top, left + target_w, top + target_h))


def gradient(size: tuple[int, int], top: str, bottom: str) -> Image.Image:
    w, h = size
    start, end = rgb(top), rgb(bottom)
    image = Image.new("RGB", size)
    draw = ImageDraw.Draw(image)
    for y in range(h):
        t = y / max(h - 1, 1)
        color = tuple(round(start[i] * (1 - t) + end[i] * t) for i in range(3))
        draw.line((0, y, w, y), fill=color)
    return image


def rounded(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: str, radius: int = 30, outline: str | None = None, width: int = 1) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def centered(draw: ImageDraw.ImageDraw, text: str, y: int, fnt: ImageFont.FreeTypeFont, fill: str, width: int = 1200) -> int:
    bbox = draw.textbbox((0, 0), text, font=fnt)
    x = (width - (bbox[2] - bbox[0])) // 2
    draw.text((x, y), text, font=fnt, fill=fill)
    return bbox[3] - bbox[1]


def brand_footer(draw: ImageDraw.ImageDraw, brand: str, page: int, total: int, width: int, height: int) -> None:
    draw.line((70, height - 76, width - 70, height - 76), fill="#CBD5E1", width=2)
    draw.text((72, height - 58), brand, font=font(24, True), fill="#475569")
    label = f"{page}/{total}"
    bbox = draw.textbbox((0, 0), label, font=font(24, True))
    draw.text((width - 72 - (bbox[2] - bbox[0]), height - 58), label, font=font(24, True), fill="#64748B")


def render_photo_hook(card: dict, common: dict, spec_dir: Path, size: tuple[int, int]) -> Image.Image:
    photo = resolve_path(card["photo"], spec_dir)
    image = cover_photo(photo, size, tuple(card.get("focus", [0.5, 0.5])))
    image = ImageEnhance.Contrast(image).enhance(1.08)
    overlay = Image.new("RGBA", size, (5, 16, 38, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(size[1]):
        alpha = int(35 + 185 * (1 - y / size[1]))
        od.line((0, y, size[0], y), fill=(4, 15, 38, alpha))
    image = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(image)
    rounded(draw, (62, 62, 430, 126), "#F97316", radius=28)
    draw.text((92, 76), card.get("eyebrow", "実測比較"), font=font(30, True), fill="#FFFFFF")
    headline = card["headline"]
    y = 176
    for line in headline[:-1]:
        draw.text((68, y), line, font=font(62, True), fill="#FFFFFF", stroke_width=2, stroke_fill="#071226")
        y += 82
    draw.text((68, y), headline[-1], font=font(112, True), fill="#FACC15", stroke_width=3, stroke_fill="#071226")
    y += 142
    rounded(draw, (64, y, 1136, y + 108), "#071226", radius=24)
    draw.text((96, y + 27), card["subhead"], font=font(40, True), fill="#FFFFFF")
    draw.text((72, 1088), card.get("note", ""), font=font(25), fill="#FFFFFF")
    return image


def render_comparison(card: dict, common: dict, spec_dir: Path, size: tuple[int, int]) -> Image.Image:
    image = gradient(size, "#EFF6FF", "#FFFFFF")
    draw = ImageDraw.Draw(image)
    centered(draw, card.get("eyebrow", "交換完了までの総額"), 62, font(30, True), "#2563EB")
    centered(draw, card["title"], 112, font(54, True), "#0F172A")
    values = card["values"]
    max_value = max(item["value"] for item in values)
    y = 300
    colors = ["#64748B", "#F97316", "#2563EB", "#10B981"]
    for idx, item in enumerate(values):
        draw.text((94, y), item["label"], font=font(36, True), fill="#334155")
        amount = item.get("display", f"{item['value']:,}円")
        bbox = draw.textbbox((0, 0), amount, font=font(48, True))
        draw.text((1106 - (bbox[2] - bbox[0]), y - 6), amount, font=font(48, True), fill="#0F172A")
        bar_y = y + 62
        rounded(draw, (94, bar_y, 1106, bar_y + 64), "#E2E8F0", radius=28)
        bar_w = round(1012 * item["value"] / max_value)
        rounded(draw, (94, bar_y, 94 + bar_w, bar_y + 64), item.get("color", colors[idx % len(colors)]), radius=28)
        y += 180
    rounded(draw, (120, 702, 1080, 842), "#FEF3C7", radius=34, outline="#F59E0B", width=3)
    centered(draw, card["difference"], 735, font(58, True), "#B45309")
    centered(draw, card.get("condition", ""), 880, font(28), "#475569")
    brand_footer(draw, common["brand"], card["page"], card["total"], *size)
    return image


def render_breakdown(card: dict, common: dict, spec_dir: Path, size: tuple[int, int]) -> Image.Image:
    image = gradient(size, "#FFF7ED", "#FFFFFF")
    draw = ImageDraw.Draw(image)
    centered(draw, card.get("eyebrow", "楽天側の内訳"), 58, font(30, True), "#EA580C")
    centered(draw, card["title"], 112, font(52, True), "#0F172A")
    boxes = [(70, 270, 575, 470), (625, 270, 1130, 470), (70, 510, 575, 710), (625, 510, 1130, 710)]
    for idx, (item, box) in enumerate(zip(card["items"], boxes)):
        rounded(draw, box, "#FFFFFF", radius=28, outline="#FED7AA", width=3)
        draw.text((box[0] + 30, box[1] + 31), item["label"], font=font(31, True), fill="#475569")
        draw.text((box[0] + 30, box[1] + 98), item["amount"], font=font(52, True), fill="#C2410C")
    draw.text((540, 760), "＋", font=font(54, True), fill="#94A3B8")
    rounded(draw, (120, 840, 1080, 1010), "#0F172A", radius=36)
    centered(draw, card["total_label"], 866, font(30, True), "#CBD5E1")
    centered(draw, card["total_amount"], 918, font(62, True), "#FACC15")
    brand_footer(draw, common["brand"], card["page"], card["total"], *size)
    return image


def render_warning(card: dict, common: dict, spec_dir: Path, size: tuple[int, int]) -> Image.Image:
    image = gradient(size, "#FFF1F2", "#FFFFFF")
    draw = ImageDraw.Draw(image)
    rounded(draw, (62, 58, 360, 122), "#DC2626", radius=28)
    draw.text((94, 72), card.get("eyebrow", "注意"), font=font(31, True), fill="#FFFFFF")
    centered(draw, card["title"], 152, font(55, True), "#7F1D1D")
    boxes = [(72, 320, 505, 570), (695, 320, 1128, 570)]
    for item, box in zip(card["wrong_pair"], boxes):
        rounded(draw, box, "#FFFFFF", radius=30, outline="#FDA4AF", width=4)
        centered_text = item["label"]
        bbox = draw.textbbox((0, 0), centered_text, font=font(34, True))
        draw.text(((box[0] + box[2] - (bbox[2] - bbox[0])) // 2, box[1] + 44), centered_text, font=font(34, True), fill="#334155")
        shop = item["shop"]
        bbox = draw.textbbox((0, 0), shop, font=font(58, True))
        draw.text(((box[0] + box[2] - (bbox[2] - bbox[0])) // 2, box[1] + 125), shop, font=font(58, True), fill="#DC2626")
    centered(draw, "×", 365, font(120, True), "#DC2626")
    centered(draw, card.get("wrong_note", "この組み合わせは利用できない"), 600, font(34, True), "#991B1B")
    rounded(draw, (72, 700, 1128, 990), "#ECFDF5", radius=36, outline="#10B981", width=4)
    centered(draw, card["solution_title"], 742, font(43, True), "#047857")
    y = 820
    for line in card["solution_lines"]:
        centered(draw, line, y, font(34, True), "#0F172A")
        y += 58
    brand_footer(draw, common["brand"], card["page"], card["total"], *size)
    return image


def render_tool_hook(card: dict, common: dict, spec_dir: Path, size: tuple[int, int]) -> Image.Image:
    image = gradient(size, "#EFF6FF", "#FFFFFF")
    draw = ImageDraw.Draw(image)
    rounded(draw, (70, 58, 700, 122), "#E8F5EE", radius=28, outline="#A7D7BC", width=2)
    draw.text((96, 73), card.get("eyebrow", "買い物判断ツール"), font=font(28, True), fill="#166534")
    y = 160
    for line in card["headline"]:
        centered(draw, line, y, font(63, True), "#0F3B5D")
        y += 82
    centered(draw, card["subhead"], y + 10, font(30, True), "#475569")

    source = Image.open(resolve_path(card["screenshot"], spec_dir)).convert("RGB")
    source.thumbnail((1040, 530), Image.Resampling.LANCZOS)
    shot_x = (size[0] - source.width) // 2
    shot_y = 485
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (shot_x - 18, shot_y - 18, shot_x + source.width + 18, shot_y + source.height + 24),
        radius=30,
        fill=(15, 59, 93, 28),
    )
    image = Image.alpha_composite(image.convert("RGBA"), shadow).convert("RGB")
    image.paste(source, (shot_x, shot_y))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (shot_x - 2, shot_y - 2, shot_x + source.width + 2, shot_y + source.height + 2),
        radius=18,
        outline="#94A3B8",
        width=2,
    )
    brand_footer(draw, common["brand"], card["page"], card["total"], *size)
    return image


def render_tool_result(card: dict, common: dict, spec_dir: Path, size: tuple[int, int]) -> Image.Image:
    image = gradient(size, "#FFF7ED", "#FFFFFF")
    draw = ImageDraw.Draw(image)
    centered(draw, card.get("eyebrow", "実際の入力例"), 62, font(30, True), "#C2410C")
    centered(draw, card["item"], 122, font(42, True), "#334155")
    centered(draw, card["result"], 210, font(82, True), "#0F5D8A")
    centered(draw, card["annual"], 320, font(38, True), "#0F172A")
    x = 74
    for item in card["conditions"]:
        rounded(draw, (x, 425, x + 320, 575), "#FFFFFF", radius=26, outline="#FED7AA", width=3)
        centered_x = x + 160
        bbox = draw.textbbox((0, 0), item["label"], font=font(25, True))
        draw.text((centered_x - (bbox[2] - bbox[0]) // 2, 458), item["label"], font=font(25, True), fill="#64748B")
        bbox = draw.textbbox((0, 0), item["value"], font=font(40, True))
        draw.text((centered_x - (bbox[2] - bbox[0]) // 2, 503), item["value"], font=font(40, True), fill="#0F172A")
        x += 365
    rounded(draw, (105, 650, 1095, 865), "#EFF6FF", radius=34, outline="#93C5FD", width=3)
    centered(draw, card["decision"], 696, font(44, True), "#0F3B5D")
    centered(draw, card["note"], 775, font(29), "#475569")
    brand_footer(draw, common["brand"], card["page"], card["total"], *size)
    return image


def render_feature_grid(card: dict, common: dict, spec_dir: Path, size: tuple[int, int]) -> Image.Image:
    image = gradient(size, "#EFF6FF", "#FFFFFF")
    draw = ImageDraw.Draw(image)
    centered(draw, card.get("eyebrow", "価格だけでは見えない"), 60, font(30, True), "#2563EB")
    for idx, line in enumerate(card["title"]):
        centered(draw, line, 116 + idx * 68, font(54, True), "#0F172A")
    boxes = [(72, 320, 565, 565), (635, 320, 1128, 565), (72, 620, 565, 865), (635, 620, 1128, 865)]
    colors = ["#E0F2FE", "#ECFDF5", "#FFF7ED", "#F5F3FF"]
    outlines = ["#38BDF8", "#34D399", "#FB923C", "#A78BFA"]
    for idx, (item, box) in enumerate(zip(card["items"], boxes)):
        rounded(draw, box, colors[idx], radius=30, outline=outlines[idx], width=3)
        centered_x = (box[0] + box[2]) // 2
        bbox = draw.textbbox((0, 0), item["label"], font=font(42, True))
        draw.text((centered_x - (bbox[2] - bbox[0]) // 2, box[1] + 48), item["label"], font=font(42, True), fill="#0F3B5D")
        bbox = draw.textbbox((0, 0), item["description"], font=font(27))
        draw.text((centered_x - (bbox[2] - bbox[0]) // 2, box[1] + 132), item["description"], font=font(27), fill="#475569")
    brand_footer(draw, common["brand"], card["page"], card["total"], *size)
    return image


def render_tool_steps(card: dict, common: dict, spec_dir: Path, size: tuple[int, int]) -> Image.Image:
    image = gradient(size, "#FFFFFF", "#F0FDF4")
    draw = ImageDraw.Draw(image)
    centered(draw, card.get("eyebrow", "使い方は3ステップ"), 60, font(30, True), "#15803D")
    centered(draw, card["title"], 120, font(55, True), "#0F172A")
    y = 270
    for idx, item in enumerate(card["steps"], 1):
        rounded(draw, (85, y, 1115, y + 142), "#FFFFFF", radius=28, outline="#BBF7D0", width=3)
        rounded(draw, (115, y + 27, 205, y + 117), "#0F5D8A", radius=45)
        number = str(idx)
        bbox = draw.textbbox((0, 0), number, font=font(43, True))
        draw.text((160 - (bbox[2] - bbox[0]) // 2, y + 45), number, font=font(43, True), fill="#FFFFFF")
        draw.text((245, y + 30), item["label"], font=font(36, True), fill="#0F172A")
        draw.text((245, y + 82), item["description"], font=font(26), fill="#64748B")
        y += 170
    rounded(draw, (110, 820, 1090, 975), "#0F3B5D", radius=34)
    centered(draw, card["result"], 850, font(40, True), "#FFFFFF")
    centered(draw, card["privacy"], 912, font(27, True), "#BFDBFE")
    brand_footer(draw, common["brand"], card["page"], card["total"], *size)
    return image


RENDERERS = {
    "photo_hook": render_photo_hook,
    "comparison": render_comparison,
    "breakdown": render_breakdown,
    "warning": render_warning,
    "tool_hook": render_tool_hook,
    "tool_result": render_tool_result,
    "feature_grid": render_feature_grid,
    "tool_steps": render_tool_steps,
}


URL_RE = re.compile(r"https?://\S+")


def x_effective_length(text: str) -> int:
    """XではURLが長さに関係なくt.coの23文字として数えられる。"""
    return len(URL_RE.sub("x" * 23, text))


COMMERCIAL_RELATIONS = {"self_paid", "affiliate_only", "provided", "sponsored", "own_product"}


def validate_post(post: dict, commercial_relation: str) -> None:
    if commercial_relation not in COMMERCIAL_RELATIONS:
        raise ValueError(
            "commercial_relation は self_paid / affiliate_only / provided / sponsored / own_product のいずれかにしてください"
        )
    main = post["main"].strip()
    effective_length = x_effective_length(main)
    if effective_length > 140:
        raise ValueError(f"X本文が実質140字を超えています: {effective_length}字")
    link_strategy = post.get("link_strategy", "reply")
    main_has_url = URL_RE.search(main) is not None
    if link_strategy == "reply" and main_has_url:
        raise ValueError("link_strategy=reply のときはURLを返信へ分離します")
    if link_strategy == "main" and not main_has_url:
        raise ValueError("link_strategy=main ですが本文に記事URLがありません")
    if link_strategy not in {"main", "reply"}:
        raise ValueError(f"未対応のlink_strategyです: {link_strategy}")
    hashtags = [token for token in main.split() if token.startswith("#")]
    max_hashtags = int(post.get("max_hashtags", 2))
    if not 1 <= len(hashtags) <= max_hashtags:
        raise ValueError(f"ハッシュタグは1〜{max_hashtags}個にしてください: {hashtags}")
    if commercial_relation == "affiliate_only" and "アフィリエイト" not in main:
        raise ValueError("affiliate_only はX本文内にアフィリエイト表示が必要です")
    if commercial_relation == "provided" and "提供" not in main:
        raise ValueError("provided はX本文上部に提供元の表示が必要です")
    if commercial_relation == "sponsored" and ("PR" not in main or "提供" not in main):
        raise ValueError("sponsored はX本文1行目に【PR】と提供元の表示が必要です")
    if commercial_relation == "own_product" and not any(label in main for label in ("自社", "当研究所")):
        raise ValueError("own_product は自社商品・当研究所のサービスであることを本文内に明記してください")
    reply = post.get("reply", "")
    if link_strategy == "reply" and "http" not in reply:
        raise ValueError("返信文に記事URLがありません")


def write_manifest(spec: dict, spec_path: Path, outputs: list[Path]) -> Path:
    output_dir = outputs[0].parent
    post = spec["post"]
    link_strategy = post.get("link_strategy", "reply")
    link_block = (
        ["## 記事リンク", "", "本文に記事URLを掲載。commercial_relationに応じた商用表示を同じ本文内に置き、追加返信は不要。"]
        if link_strategy == "main"
        else ["## 返信（記事リンク）", "", post["reply"]]
    )
    lines = [
        "# X拡散セット",
        "",
        "## 訴求分析",
        "",
        *[f"- {item}" for item in spec.get("analysis", [])],
        "",
        f"## 投稿本文（URL{'あり' if link_strategy == 'main' else 'なし'}・X換算{x_effective_length(post['main'])}字）",
        "",
        post["main"],
        "",
        *link_block,
        "",
        "## 添付画像（順番固定）",
        "",
        *[f"{idx}. `{path}`" for idx, path in enumerate(outputs, 1)],
        "",
        "## 投稿前チェック",
        "",
        "- [ ] 本文が140字以内",
        "- [ ] 画像4枚が01→04の順番",
        f"- [ ] commercial_relation={spec['commercial_relation']} に合う表示が同じ本文内にある",
        "- [ ] 最後の『ポストする』はユーザーが押す",
        "",
        f"生成元: `{spec_path}`",
    ]
    manifest = output_dir / "campaign.md"
    manifest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="X拡散セットを生成")
    parser.add_argument("--spec", required=True, help="キャンペーンJSON")
    args = parser.parse_args()

    spec_path = Path(args.spec).expanduser().resolve()
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    if "commercial_relation" not in spec:
        raise ValueError("キャンペーンJSONにcommercial_relationを指定してください")
    validate_post(spec["post"], spec["commercial_relation"])

    width = int(spec.get("width", 1200))
    height = int(spec.get("height", 1200))
    if max(width, height) > 1800:
        raise ValueError("画像の長辺は1800px以下にしてください")
    size = (width, height)
    output_dir = resolve_path(spec["output_dir"], spec_path.parent)
    output_dir.mkdir(parents=True, exist_ok=True)

    cards = spec["cards"]
    total = len(cards)
    outputs: list[Path] = []
    for idx, card in enumerate(cards, 1):
        renderer = RENDERERS.get(card["type"])
        if renderer is None:
            raise ValueError(f"未対応のカード種別: {card['type']}")
        card = dict(card)
        card["page"] = idx
        card["total"] = total
        image = renderer(card, spec, spec_path.parent, size)
        filename = card.get("filename", f"{idx:02d}-{card['type']}.png")
        output = output_dir / filename
        if output.exists():
            raise FileExistsError(f"既存ファイルを上書きしません: {output}")
        image.save(output, "PNG", optimize=True)
        outputs.append(output)

    manifest = write_manifest(spec, spec_path, outputs)
    print(f"✅ X拡散セット生成: {output_dir}")
    for output in outputs:
        print(f"   🖼 {output.name} ({Image.open(output).size[0]}x{Image.open(output).size[1]})")
    print(f"   📝 {manifest.name}")


if __name__ == "__main__":
    main()
