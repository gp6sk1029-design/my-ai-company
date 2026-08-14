"""
wp_block_builder.py
WordPressブロック生成ライブラリ（JIN:R対応）

【重要】このファイルは検証済みの正規ブロック形式のみを使用する。
各関数は実際のJIN:R記事(ID:526/552)から抽出した正確なフォーマットに準拠。
"""

import re


# ============================================================
# HTMLヘルパー
# ============================================================

def _strip_backticks(text: str) -> str:
    """`x` インラインコード記法はJIN:R表示で装飾されず「`」が露出するため、記号だけ剥がす。
    （2026-07-18制定：ROI表の計算式セルで露出事故が4記事分発生した恒久対策）"""
    return re.sub(r'`([^`]*)`', r'\1', text)


def md_to_html_inline(text: str) -> str:
    """
    インラインmarkdown → HTML変換（strongタグの閉じ忘れを防ぐ）

    JIN:R 装飾ルール（2026/04 HUAWEI記事の失敗から追加）:
    ① ***xxx***（アスタリスク3つ）→ <strong> + 水色アンダーライン（明示的最重要強調）
    ② **xxx** に数値・単位・日付を含む    → 自動で水色アンダーライン付与
    ③ **xxx** その他                      → 普通の <strong>

    水色アンダーライン仕様: #56CCF2 / 3px（2026/05/11に2px→3pxへ強化）
    """
    def _wrap_underline(inner: str) -> str:
        return (
            '<strong><span style="text-decoration:underline;'
            'text-decoration-color:#56CCF2;text-decoration-thickness:3px;">'
            + inner + '</span></strong>'
        )

    # ⓪-a `x` インラインコードの「`」露出防止（記号を剥がす）
    text = _strip_backticks(text)

    # ⓪ [文字](URL) → リンク（画像 ![]() は除外するため ! の直後はマッチさせない）
    text = re.sub(
        r'(?<!\!)\[([^\]]+)\]\((https?://[^)]+)\)',
        r'<a href="\2" target="_blank" rel="noopener nofollow sponsored">\1</a>',
        text,
    )

    # ① ***xxx*** → 水色アンダーライン付き strong（最優先）
    text = re.sub(r'\*\*\*(.+?)\*\*\*', lambda m: _wrap_underline(m.group(1)), text)

    # ② **xxx** を処理
    #    数値・単位・金額・日付を含むものは自動で水色アンダーライン
    _UL_TRIGGER = re.compile(r'[0-9]|[\uff10-\uff19]|¥|円|％|%|日|分|時間|週|月|年|kg|g|mm|cm|km|nit|bpm|ms|回|MB|GB')
    def _bold_replace(m):
        inner = m.group(1)
        if _UL_TRIGGER.search(inner):
            return _wrap_underline(inner)
        return f'<strong>{inner}</strong>'
    text = re.sub(r'\*\*(.+?)\*\*', _bold_replace, text)

    # ③ *italic*（** 変換後に処理して strong 内の * を誤変換しない）
    text = re.sub(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)', r'<em>\1</em>', text)

    # 変換後のstrongタグのバランスを検証・自動修正
    opens  = text.count('<strong>')
    closes = text.count('</strong>')
    if opens > closes:
        text += '</strong>' * (opens - closes)
    elif closes > opens:
        text = '<strong>' * (closes - opens) + text

    return text


# ============================================================
# ブロック生成関数（JIN:R検証済み）
# ============================================================

def block_separator() -> str:
    return '<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->'


def block_heading(text: str, level: int = 2) -> str:
    """
    見出しブロック
    ※JIN:Rは class="wp-block-heading jinr-heading d--bold" が必須
    """
    return (
        f'<!-- wp:heading {{"level":{level}}} -->\n'
        f'<h{level} class="wp-block-heading jinr-heading d--bold">{text}</h{level}>\n'
        f'<!-- /wp:heading -->'
    )


def block_paragraph(text: str) -> str:
    """段落ブロック"""
    html = md_to_html_inline(text)
    return f'<!-- wp:paragraph -->\n<p>{html}</p>\n<!-- /wp:paragraph -->'


def block_list(items: list) -> str:
    """
    リストブロック
    ※JIN:Rは ul class="wp-block-list jinr-list" + wp:list-item ラッパーが必須
    """
    items_html = ''.join(
        f'<!-- wp:list-item -->\n<li>{md_to_html_inline(item)}</li>\n<!-- /wp:list-item -->'
        for item in items
    )
    return (
        '<!-- wp:list -->\n'
        f'<ul class="wp-block-list jinr-list">{items_html}</ul>\n'
        '<!-- /wp:list -->'
    )


def block_quote(text: str) -> str:
    """引用ブロック"""
    html = md_to_html_inline(text)
    return (
        '<!-- wp:quote -->\n'
        '<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n'
        f'<p>{html}</p>\n'
        '<!-- /wp:paragraph --></blockquote>\n'
        '<!-- /wp:quote -->'
    )


def block_code(text: str) -> str:
    """コードブロック"""
    return f'<!-- wp:code -->\n<pre class="wp-block-code"><code>{text}</code></pre>\n<!-- /wp:code -->'


def block_image(wp_id: int, url: str, alt: str = '') -> str:
    """
    画像ブロック
    ※sizeSlug は "full" を使用（"large" は検証エラーの原因）
    ※figcaption は使用しない（検証エラーの原因）
    """
    return (
        f'<!-- wp:image {{"id":{wp_id},"sizeSlug":"full","linkDestination":"none"}} -->\n'
        f'<figure class="wp-block-image size-full">'
        f'<img src="{url}" alt="{alt}" class="wp-image-{wp_id}"/>'
        f'</figure>\n'
        f'<!-- /wp:image -->'
    )


def block_product_box(name: str, image: str = '', amazon: str = '',
                      rakuten: str = '', yahoo: str = '',
                      rakuten_label: str = '楽天市場で購入') -> str:
    """商品リンクボックス（Amazon/楽天/Yahooのアフィリボタン付きカード）。
    テーマに依存しないよう全てインラインCSSで自己完結させる（JIN:R以外でも崩れない）。
    ボタンは URL が指定されたものだけ表示する（Amazonのみでも成立）。
    2026-07-21新設。
    """
    name_h = md_to_html_inline(name)
    # 🖼 カード画像は96pxでしか表示しないので、Amazon画像は小さい版に差し替える
    #   （2026-07-27：_AC_SL1500_ の原寸78KBを96px枠で表示していた＝1枚あたり約66KBのムダ。
    #    _AC_SL320_ なら11KB＝85%減。Retina(2倍)でも192px必要なので320pxで余裕がある）
    image = re.sub(r'\._AC_S[LXY]\d+_\.', '._AC_SL320_.', image) if image else image
    # 画像（任意）。無ければ左カラムごと省いてボタンを広く使う
    img_html = (
        f'<div style="flex:0 0 96px;display:flex;align-items:center;justify-content:center;">'
        # width/height属性は付けない：商品画像は正方形とは限らず（例 320x193）、
        # 96x96 を宣言すると読み込み時に枠が縮んでガタつく（レイアウトシフト）
        f'<img src="{image}" alt="{name}" loading="lazy" decoding="async" '
        f'style="max-width:96px;max-height:96px;width:auto;height:auto;object-fit:contain;border-radius:6px;"/>'
        f'</div>'
    ) if image else ''

    def btn(url, label, bg):
        # rel は sponsored（アフィリンク）＋ nofollow。target=_blank で別タブ
        return (
            f'<a href="{url}" target="_blank" rel="sponsored nofollow noopener" '
            f'style="display:block;flex:1 1 160px;text-align:center;text-decoration:none;'
            f'background:{bg};color:#fff;font-weight:700;font-size:15px;line-height:1.4;'
            f'padding:12px 16px;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,.12);">'
            f'{label}</a>'
        )
    btns = []
    if amazon:
        btns.append(btn(amazon, 'Amazonで購入', 'linear-gradient(180deg,#ff9b45,#f97316)'))
    if rakuten:
        btns.append(btn(
            rakuten,
            md_to_html_inline(rakuten_label),
            'linear-gradient(180deg,#e2467a,#bf0043)',
        ))
    if yahoo:
        btns.append(btn(yahoo, 'Yahoo!で購入', 'linear-gradient(180deg,#5b8def,#2f5fd0)'))
    btns_html = (
        '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;">'
        + ''.join(btns) + '</div>'
    )
    inner = (
        '<div class="ptgl-product-box" '
        'style="border:1px solid #e5e7eb;border-radius:12px;padding:16px 18px;margin:20px 0;'
        'background:#ffffff;box-shadow:0 1px 3px rgba(0,0,0,.06);">'
        '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;">'
        + img_html +
        '<div style="flex:1 1 220px;min-width:200px;">'
        f'<div style="font-weight:700;font-size:16px;color:#111827;margin-bottom:10px;'
        f'line-height:1.5;">{name_h}</div>'
        + btns_html +
        '</div></div></div>'
    )
    return f'<!-- wp:html -->\n{inner}\n<!-- /wp:html -->'


def block_table(headers: list, rows: list) -> str:
    """テーブルブロック"""
    thead = '<tr>' + ''.join(f'<th>{md_to_html_inline(h)}</th>' for h in headers) + '</tr>'
    tbody = ''.join(
        '<tr>' + ''.join(f'<td>{md_to_html_inline(c)}</td>' for c in row) + '</tr>'
        for row in rows
    )
    return (
        '<!-- wp:table -->\n'
        f'<figure class="wp-block-table"><table>'
        f'<thead>{thead}</thead>'
        f'<tbody>{tbody}</tbody>'
        f'</table></figure>\n'
        '<!-- /wp:table -->'
    )


# ============================================================
# JIN:R 吹き出しスロット定義
#
# 重要訂正（2026-05-03）：
# 旧版は「registerData:1 / [jinr_fukidashi2]」のように registerData と shortcode が
# 不整合だった。実検証の結果、JIN:R は shortcode 番号 = slot 番号 で表情を決定し、
# registerData は不一致でも無視される。両者を**slot番号で揃える**のが正解。
#
# slot 1 = オオタニ所長 通常
# slot 2 = オオタニ所長 ドヤ顔
# slot 3 = オオタニ所長 悩む
# slot 4 = オオタニ所長 焦り
# slot 5 = オオタニ所長 恥ずかしい
# slot 6 = 新人タナカ 通常
# slot 7 = 新人タナカ 驚き
# slot 8 = 新人タナカ 絶望
# slot 9 = 新人タナカ 怪しげ
# slot 10 = 新人タナカ ドヤ顔
# ============================================================

def _build_ootani_block(slot: int, text: str) -> str:
    """オオタニ所長ふきだし（左レイアウト）。slot 1-5 のみ有効。"""
    if slot not in (1, 2, 3, 4, 5):
        raise ValueError(f"オオタニ所長は slot 1-5 のみ。指定: {slot}")
    html = md_to_html_inline(text)
    return (
        f'<!-- wp:jinr-blocks/fukidashi {{"registerData":{slot},"designType":"d\\u002d\\u002dfukidashi-chat",'
        '"charaBorderColorSelect":"simplecolor","charaBorderColor":"#eee"} -->\n'
        '<section class="wp-block-jinr-blocks-fukidashi b--jinr-block b--jinr-fukidashi">'
        f'[jinr_fukidashi{slot}]<div class="o--fukidashi-inner"><!-- wp:paragraph -->\n'
        f'<p>{html}</p>\n'
        f'<!-- /wp:paragraph --></div>[/jinr_fukidashi{slot}]</section>\n'
        '<!-- /wp:jinr-blocks/fukidashi -->'
    )


def _build_tanaka_block(slot: int, text: str) -> str:
    """新人タナカふきだし（右レイアウト）。slot 6-10 のみ有効。"""
    if slot not in (6, 7, 8, 9, 10):
        raise ValueError(f"新人タナカは slot 6-10 のみ。指定: {slot}")
    html = md_to_html_inline(text)
    return (
        f'<!-- wp:jinr-blocks/fukidashi {{"registerData":{slot},"designType":"d\\u002d\\u002dfukidashi-chat",'
        '"charaName":"新人タナカ","charaBorderColorSelect":"simplecolor","charaBorderColor":"#eee",'
        '"bgColor":"#fff","layout":"d\\u002d\\u002dfukidashi-right"} -->\n'
        '<section class="wp-block-jinr-blocks-fukidashi b--jinr-block b--jinr-fukidashi">'
        f'[jinr_fukidashi{slot}]<div class="o--fukidashi-inner"><!-- wp:paragraph -->\n'
        f'<p>{html}</p>\n'
        f'<!-- /wp:paragraph --></div>[/jinr_fukidashi{slot}]</section>\n'
        '<!-- /wp:jinr-blocks/fukidashi -->'
    )


# 既存API互換用の薄いラッパー（デフォルトで「通常」を返す）
def block_fukidashi_ootani(text: str, slot: int = 1) -> str:
    """オオタニ所長ふきだし（デフォルト：通常 slot=1）"""
    return _build_ootani_block(slot, text)


def block_fukidashi_tanaka(text: str, slot: int = 6) -> str:
    """新人タナカふきだし（デフォルト：通常 slot=6）"""
    return _build_tanaka_block(slot, text)


# 表情指定用の便利関数
def block_fukidashi_ootani_normal(text):       return _build_ootani_block(1, text)
def block_fukidashi_ootani_doya(text):         return _build_ootani_block(2, text)
def block_fukidashi_ootani_nayamu(text):       return _build_ootani_block(3, text)
def block_fukidashi_ootani_aseri(text):        return _build_ootani_block(4, text)
def block_fukidashi_ootani_hazukashii(text):   return _build_ootani_block(5, text)

def block_fukidashi_tanaka_normal(text):       return _build_tanaka_block(6, text)
def block_fukidashi_tanaka_odoroki(text):      return _build_tanaka_block(7, text)
def block_fukidashi_tanaka_zetsubou(text):     return _build_tanaka_block(8, text)
def block_fukidashi_tanaka_ayashige(text):     return _build_tanaka_block(9, text)
def block_fukidashi_tanaka_doya(text):         return _build_tanaka_block(10, text)


def choose_ootani_expression(text: str) -> int:
    """テキスト内容からオオタニ所長の最適表情slotを推定（1-5）"""
    if any(k in text for k in ['断言', '一目瞭然', '最大の差', '実績のある', '安い買い物', '証明してくれた', '間違いない', 'これに尽きる']):
        return 2  # ドヤ顔
    if any(k in text for k in ['正直に言います', 'すまん', '反省', '申し訳', '言い訳']):
        return 5  # 恥ずかしい
    if any(k in text for k in ['ヤバい', 'まずい', '焦', 'パニック']):
        return 4  # 焦り
    if any(k in text for k in ['悩', 'どうしよう', '迷う', '困った']):
        return 3  # 悩む
    return 1  # 通常（デフォルト）


def choose_tanaka_expression(text: str) -> int:
    """テキスト内容から新人タナカの最適表情slotを推定（6-10）"""
    # 驚きを最優先（「えっ！本当ですか」など、怪しげより自然な反応）
    if any(k in text for k in ['！？', '!?', 'えっ', 'えー', 'うわ', 'まじ', 'マジ', 'びっくり']):
        return 7  # 驚き
    if any(k in text for k in ['ですよね', 'やっぱり', 'すごい', '天才', 'さすが']):
        return 10  # ドヤ顔
    if any(k in text for k in ['絶望', '泣', '無理', '深刻']):
        return 8  # 絶望
    if any(k in text for k in ['信用されません', '怪しい', '隠してる', '本当に？']):
        return 9  # 怪しげ
    return 6  # 通常（デフォルト）


# ============================================================
# Markdown → Gutenbergブロック 一括変換
# ============================================================

def markdown_to_blocks(md_text: str) -> str:
    """
    Markdownテキストを Gutenbergブロック形式に変換する。
    各ブロック関数を使用するため、常に正規形式で出力される。
    """
    blocks = []
    lines  = md_text.split('\n')
    i = 0

    while i < len(lines):
        line = lines[i]

        # --- オオタニ所長ふきだし（表情を内容から自動推定） ---
        m = re.match(r'\*\*オオタニ所長[：:]\*\*[「\s]*(.*?)[」]?\s*$', line)
        if m:
            text = m.group(1)
            slot = choose_ootani_expression(text)
            blocks.append(_build_ootani_block(slot, text))
            i += 1; continue

        # --- タナカふきだし（表情を内容から自動推定） ---
        m = re.match(r'\*\*タナカ[：:]\*\*[「\s]*(.*?)[」]?\s*$', line)
        if m:
            text = m.group(1)
            slot = choose_tanaka_expression(text)
            blocks.append(_build_tanaka_block(slot, text))
            i += 1; continue

        # --- 表情明示記法: **オオタニ所長[ドヤ顔]：** や **タナカ[驚き]：** ---
        m = re.match(r'\*\*オオタニ所長\[(通常|ドヤ顔|悩む|焦り|恥ずかしい)\][：:]\*\*[「\s]*(.*?)[」]?\s*$', line)
        if m:
            slot_map = {'通常':1,'ドヤ顔':2,'悩む':3,'焦り':4,'恥ずかしい':5}
            blocks.append(_build_ootani_block(slot_map[m.group(1)], m.group(2)))
            i += 1; continue
        m = re.match(r'\*\*タナカ\[(通常|驚き|絶望|怪しげ|ニヤ顔|ドヤ顔)\][：:]\*\*[「\s]*(.*?)[」]?\s*$', line)
        if m:
            slot_map = {'通常':6,'驚き':7,'絶望':8,'怪しげ':9,'ニヤ顔':9,'ドヤ顔':10}
            blocks.append(_build_tanaka_block(slot_map[m.group(1)], m.group(2)))
            i += 1; continue

        # --- H2見出し ---
        m = re.match(r'^## (.+)$', line)
        if m:
            blocks.append(block_heading(m.group(1).strip(), 2))
            i += 1; continue

        # --- H3見出し ---
        m = re.match(r'^### (.+)$', line)
        if m:
            blocks.append(block_heading(m.group(1).strip(), 3))
            i += 1; continue

        # --- 区切り線 ---
        if line.strip() == '---':
            blocks.append(block_separator())
            i += 1; continue

        # --- テーブル ---
        if line.startswith('|'):
            table_lines = []
            while i < len(lines) and lines[i].startswith('|'):
                cells = [c.strip() for c in lines[i].split('|')[1:-1]]
                table_lines.append(cells)
                i += 1
            if len(table_lines) >= 2:
                headers   = table_lines[0]
                body_rows = [r for r in table_lines[2:] if any(c.strip() for c in r)]
                blocks.append(block_table(headers, body_rows))
            continue

        # --- 引用 ---
        m = re.match(r'^> (.+)$', line)
        if m:
            blocks.append(block_quote(m.group(1)))
            i += 1; continue

        # --- コードブロック ---
        if line.startswith('```'):
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                code_lines.append(lines[i])
                i += 1
            blocks.append(block_code('\n'.join(code_lines)))
            i += 1; continue

        # --- リスト ---
        if re.match(r'^[-*✅❌] |^- \[ \]', line):
            items = []
            while i < len(lines) and re.match(r'^[-*✅❌] |^- \[ \]', lines[i]):
                item = re.sub(r'^[-*✅❌] (\[ \] )?', '', lines[i])
                items.append(item)
                i += 1
            blocks.append(block_list(items))
            continue

        # --- 商品リンクボックス（:::product ... ::: ） ---
        if line.strip() == ':::product':
            i += 1
            fields = {}
            while i < len(lines) and lines[i].strip() != ':::':
                mkv = re.match(
                    r'^\s*(name|image|amazon|rakuten|rakuten_label|yahoo)\s*:\s*(.+?)\s*$',
                    lines[i],
                )
                if mkv:
                    fields[mkv.group(1)] = mkv.group(2)
                i += 1
            if i < len(lines):
                i += 1  # 閉じ ::: を消費
            blocks.append(block_product_box(
                name=fields.get('name', '商品'),
                image=fields.get('image', ''),
                amazon=fields.get('amazon', ''),
                rakuten=fields.get('rakuten', ''),
                yahoo=fields.get('yahoo', ''),
                rakuten_label=fields.get('rakuten_label', '楽天市場で購入'),
            ))
            continue

        # --- 既存のGutenbergブロックをパススルー（wp:image など） ---
        m_block = re.match(r'^<!--\s*wp:(\w+)', line)
        if m_block:
            block_type = m_block.group(1)
            end_marker = f'<!-- /wp:{block_type} -->'
            block_lines = [line]
            i += 1
            while i < len(lines):
                block_lines.append(lines[i])
                if end_marker in lines[i]:
                    i += 1
                    break
                i += 1
            blocks.append('\n'.join(block_lines))
            continue

        # --- 空行・コメントスキップ ---
        if not line.strip() or line.startswith('<!--'):
            i += 1; continue

        # --- 通常段落 ---
        text = line.strip()
        if text:
            blocks.append(block_paragraph(text))
        i += 1

    return '\n\n'.join(blocks)


# ============================================================
# 検証関数
# ============================================================

def validate_blocks(content: str) -> list:
    """
    生成したブロックコンテンツの問題点を検出して返す。
    投稿前に必ず呼び出すこと。
    """
    errors = []

    for i, line in enumerate(content.split('\n'), 1):
        opens  = line.count('<strong>')
        closes = line.count('</strong>')
        if opens != closes:
            errors.append(f"行{i}: strongタグ不一致 open:{opens} close:{closes}")

        if '<h2 class="wp-block-heading">' in line or '<h3 class="wp-block-heading">' in line:
            if 'jinr-heading' not in line:
                errors.append(f"行{i}: headingにjinr-headingクラスなし")

        if re.search(r'\*\*[^\*]+\*\*', line):
            errors.append(f"行{i}: **markdown**が変換されていない")

        if '<ul>' in line and 'wp-block-list' not in line:
            errors.append(f"行{i}: ulにwp-block-listクラスなし")

    return errors
