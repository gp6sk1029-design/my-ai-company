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

def md_to_html_inline(text: str) -> str:
    """
    インラインmarkdown → HTML変換（strongタグの閉じ忘れを防ぐ）
    **text** → <strong>text</strong>
    *text*   → <em>text</em>
    """
    # **bold** を変換（非貪欲マッチ）
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    # *italic* を変換（**変換後に実行してstrong内の*を誤変換しない）
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


def block_fukidashi_ootani(text: str) -> str:
    """
    オオタニ所長ふきだし（左）
    registerData:1 → [jinr_fukidashi2]
    """
    html = md_to_html_inline(text)
    return (
        '<!-- wp:jinr-blocks/fukidashi {"registerData":1,"designType":"d\\u002d\\u002dfukidashi-chat",'
        '"charaBorderColorSelect":"simplecolor","charaBorderColor":"#eee"} -->\n'
        '<section class="wp-block-jinr-blocks-fukidashi b--jinr-block b--jinr-fukidashi">'
        '[jinr_fukidashi2]<div class="o--fukidashi-inner"><!-- wp:paragraph -->\n'
        f'<p>{html}</p>\n'
        '<!-- /wp:paragraph --></div>[/jinr_fukidashi2]</section>\n'
        '<!-- /wp:jinr-blocks/fukidashi -->'
    )


def block_fukidashi_tanaka(text: str) -> str:
    """
    タナカふきだし（右）
    registerData:8 → [jinr_fukidashi9]
    """
    html = md_to_html_inline(text)
    return (
        '<!-- wp:jinr-blocks/fukidashi {"registerData":8,"designType":"d\\u002d\\u002dfukidashi-chat",'
        '"charaName":"新人タナカ","charaBorderColorSelect":"simplecolor","charaBorderColor":"#eee",'
        '"bgColor":"#fff","layout":"d\\u002d\\u002dfukidashi-right"} -->\n'
        '<section class="wp-block-jinr-blocks-fukidashi b--jinr-block b--jinr-fukidashi">'
        '[jinr_fukidashi9]<div class="o--fukidashi-inner"><!-- wp:paragraph -->\n'
        f'<p>{html}</p>\n'
        '<!-- /wp:paragraph --></div>[/jinr_fukidashi9]</section>\n'
        '<!-- /wp:jinr-blocks/fukidashi -->'
    )


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

        # --- オオタニ所長ふきだし ---
        m = re.match(r'\*\*オオタニ所長[：:]\*\*[「\s]*(.*?)[」]?\s*$', line)
        if m:
            blocks.append(block_fukidashi_ootani(m.group(1)))
            i += 1; continue

        # --- タナカふきだし ---
        m = re.match(r'\*\*タナカ[：:]\*\*[「\s]*(.*?)[」]?\s*$', line)
        if m:
            blocks.append(block_fukidashi_tanaka(m.group(1)))
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
