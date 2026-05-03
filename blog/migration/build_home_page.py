#!/usr/bin/env python3
"""
本番WP（www.ootanisatan.com）に「ホーム固定ページ」を作成・更新する。

構成（プレビュー版同等）：
1. ヒーロー（PTGLバナー背景）
2. カテゴリ4カード
3. ★注目の記事（3カード）
4. ★最新の記事（5項目）
5. サイドバー（4ウィジェット）
6. ボトム4特徴
7. （フッターはJIN:R既定）

実行：
  python3 blog/migration/build_home_page.py
"""
from __future__ import annotations
import json, time
from base64 import b64encode
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from pathlib import Path

CONFIG = json.loads(open("/Users/shoheikoda/Documents/my-ai-company/blog/config.json").read())
auth = b64encode(f"{CONFIG['wp_auth']['username']}:{CONFIG['wp_auth']['application_password']}".encode()).decode()
BASE = CONFIG['wordpress_url']

# 公開記事情報（snapshots に保存済）
posts_data = json.loads(Path('/Users/shoheikoda/Documents/my-ai-company/blog/migration/snapshots/published-posts-and-cats.json').read_text())
POSTS = {p['id']: p for p in posts_data['posts']}

# Cloudflareプレビュー上のヒーロー画像URL（暫定・WAF解決後にWP内画像に差替予定）
HERO_BANNER_URL = "https://ootanisatan-preview.pages.dev/assets/img/hero-banner.png"

# カテゴリページURL（既に存在する固定ページに飛ばす）
CAT_LINKS = {
    'gadget':    'https://www.ootanisatan.com/gadget-lab/',
    'seigi':     '/category/seigi-lab/',
    'jitan':     'https://www.ootanisatan.com/jitan-tool-lab/',
    'kurashi':   'https://www.ootanisatan.com/%E6%9A%AE%E3%82%89%E3%81%97%E3%83%8F%E3%83%83%E3%82%AF%E7%A0%94%E7%A9%B6%E5%AE%A4/',
}

# 各記事のメタ（注目の記事・最新の記事用）
def get_post(pid):
    return POSTS.get(pid, {})

def html_post_card(pid, tag_label, tag_color):
    """注目の記事用カード"""
    p = get_post(pid)
    if not p: return ''
    return f'''<a href="{p['link']}" class="ot-featured-card">
  <div class="ot-featured-thumb" style="background-image:url('{p.get('thumb_url','')}');">
    <span class="ot-featured-tag" style="background:{tag_color}">{tag_label}</span>
  </div>
  <div class="ot-featured-body">
    <div class="ot-featured-title">{p['title']}</div>
    <div class="ot-featured-date">🕐 {p['date']}</div>
  </div>
</a>'''

def html_post_listitem(pid, tag_label, tag_color):
    """最新の記事用リスト項目"""
    p = get_post(pid)
    if not p: return ''
    return f'''<a href="{p['link']}" class="ot-latest-item">
  <div class="ot-latest-thumb" style="background-image:url('{p.get('thumb_url','')}');"></div>
  <div class="ot-latest-title">{p['title']}</div>
  <span class="ot-latest-tag" style="background:{tag_color}">{tag_label}</span>
  <span class="ot-latest-date">{p['date']}</span>
</a>'''


def build_content():
    # WordPress Custom HTML ブロック形式
    html = f'''<!-- wp:html -->
<div class="ot-home-wrap">

  <!-- HERO -->
  <section class="ot-hero" style="background:linear-gradient(90deg, rgba(240,249,255,1) 0%, rgba(240,249,255,0.85) 30%, rgba(240,249,255,0) 55%), url('{HERO_BANNER_URL}') center right / cover no-repeat, linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 60%, #dbeafe 100%);">
    <div class="ot-hero-inner">
      <h2 class="ot-hero-title"><span class="hl">ガジェット</span>と<span class="hl">生産技術</span>の力で、<br>現場の「ムダ」をなくし、仕事と生活をアップデート。</h2>
      <p class="ot-hero-desc">スマートウォッチや便利なツールからPLC・センサ・FA・効率ノウハウまで。<br>エンジニアの毎日を効率化する実践的な情報を発信します。</p>
      <div class="ot-hero-cta">
        <a href="#latest" class="ot-btn ot-btn-primary">📤 最新の記事を読む</a>
        <a href="#categories" class="ot-btn ot-btn-secondary">📁 カテゴリから探す</a>
      </div>
    </div>
  </section>

  <!-- 4 CATEGORY CARDS -->
  <section class="ot-cat-section" id="categories">
    <div class="ot-cat-grid">
      <a href="{CAT_LINKS['gadget']}" class="ot-cat-card">
        <div class="ot-cat-icon ot-cat-blue">⌚</div>
        <h3>ガジェット研究室</h3>
        <p>スマートウォッチ・PC周辺機器・<br>便利グッズのレビューと活用術</p>
        <div class="ot-cat-arrow">→</div>
      </a>
      <a href="{CAT_LINKS['seigi']}" class="ot-cat-card">
        <div class="ot-cat-icon ot-cat-blue">⚙️</div>
        <h3>生産技術研究室</h3>
        <p>PLC・センサ・安全・改善・<br>生産技術のノウハウと事例</p>
        <div class="ot-cat-arrow">→</div>
      </a>
      <a href="{CAT_LINKS['jitan']}" class="ot-cat-card">
        <div class="ot-cat-icon ot-cat-blue">⏱</div>
        <h3>時短ツール研究室</h3>
        <p>AIツール・アプリ・効率化ツールで<br>時短につながる活用法を紹介</p>
        <div class="ot-cat-arrow">→</div>
      </a>
      <a href="{CAT_LINKS['kurashi']}" class="ot-cat-card ot-cat-orange-bg">
        <div class="ot-cat-icon ot-cat-orange">🏠</div>
        <h3>暮らしハック研究室</h3>
        <p>日常の効率化・健康・節約など<br>暮らしに役立つ実践的なヒント</p>
        <div class="ot-cat-arrow">→</div>
      </a>
    </div>
  </section>

  <!-- 2-COLUMN: MAIN + SIDEBAR -->
  <section class="ot-content-section">
    <div class="ot-content-grid">
      <div class="ot-main-col">

        <h2 class="ot-section-heading" id="featured">注目の記事</h2>
        <div class="ot-featured-grid">
          {html_post_card(605, 'ガジェットレビュー', '#2563eb')}
          {html_post_card(526, 'ガジェットレビュー', '#2563eb')}
          {html_post_card(12, '生産技術', '#1e3a8a')}
        </div>

        <h2 class="ot-section-heading" id="latest">最新の記事</h2>
        <div class="ot-latest-list">
          {html_post_listitem(605, 'ガジェットレビュー', '#2563eb')}
          {html_post_listitem(552, 'ガジェットレビュー', '#2563eb')}
          {html_post_listitem(526, 'ガジェットレビュー', '#2563eb')}
          {html_post_listitem(450, 'ガジェットレビュー', '#2563eb')}
          {html_post_listitem(12, '生産技術', '#1e3a8a')}
          <a href="/?s=" class="ot-latest-more">記事一覧をみる →</a>
        </div>

      </div>

      <aside class="ot-sidebar">
        <div class="ot-search-widget">
          <form action="/" method="get">
            <input type="text" name="s" placeholder="検索キーワードを入力">
            <button type="submit">🔍</button>
          </form>
        </div>

        <div class="ot-widget">
          <h3 class="ot-widget-title">運営者プロフィール</h3>
          <div class="ot-profile-body">
            <img class="ot-profile-avatar" src="https://www.ootanisatan.com/wp-content/uploads/2026/05/E382AAE382AAE382BFE3838BE68980E995B7-E9809AE5B8B8.jpg" alt="所長">
            <div>
              <p class="ot-profile-text">生産技術エンジニア。<br>工場の安全・効率化に取り組むエンジニア。ガジェットと生産技術で、日々の仕事を強化する情報を発信しています。</p>
              <a class="ot-profile-link" href="/%E3%83%97%E3%83%AD%E3%83%95%E3%82%A3%E3%83%BC%E3%83%AB/">プロフィールをみる →</a>
            </div>
          </div>
        </div>

        <div class="ot-widget">
          <h3 class="ot-widget-title">人気記事ランキング</h3>
          <ol class="ot-ranking-list">
            <li><a href="{POSTS[605]['link']}">
              <span class="ot-rank-icon">🥇</span>
              <div class="ot-rank-thumb" style="background-image:url('{POSTS[605]['thumb_url']}');"></div>
              <div class="ot-rank-title">{POSTS[605]['title']}</div>
            </a></li>
            <li><a href="{POSTS[526]['link']}">
              <span class="ot-rank-icon">🥈</span>
              <div class="ot-rank-thumb" style="background-image:url('{POSTS[526]['thumb_url']}');"></div>
              <div class="ot-rank-title">{POSTS[526]['title']}</div>
            </a></li>
            <li><a href="{POSTS[450]['link']}">
              <span class="ot-rank-icon">🥉</span>
              <div class="ot-rank-thumb" style="background-image:url('{POSTS[450]['thumb_url']}');"></div>
              <div class="ot-rank-title">{POSTS[450]['title']}</div>
            </a></li>
          </ol>
        </div>

        <div class="ot-learn-widget">
          <div class="ot-learn-text">なにか知りたいこと？<br>一緒に学んでいきましょう！</div>
          <img src="https://www.ootanisatan.com/wp-content/uploads/2026/05/E696B0E4BABAE382BFE3838AE382AB-E9809AE5B8B8.jpg" alt="新人タナカ">
        </div>
      </aside>
    </div>
  </section>

  <!-- BOTTOM 4 FEATURES -->
  <section class="ot-features-section">
    <div class="ot-features-grid">
      <div class="ot-feature-item">
        <div class="ot-feature-icon">📋</div>
        <h3>実体験ベースのレビュー</h3>
        <p>実際に使って検証した情報だけを<br>基準にレビューします。</p>
      </div>
      <div class="ot-feature-item">
        <div class="ot-feature-icon">⚙️</div>
        <h3>生産技術の知見を共有</h3>
        <p>現場での改善提案・自動化の<br>ノウハウをわかりやすく解説。</p>
      </div>
      <div class="ot-feature-item">
        <div class="ot-feature-icon">🤖</div>
        <h3>FA・PLC・自動化に強い</h3>
        <p>制御・センサ安全・ネットワークまで<br>幅広くカバー。</p>
      </div>
      <div class="ot-feature-item">
        <div class="ot-feature-icon">💡</div>
        <h3>明日から使える実践ノウハウ</h3>
        <p>すぐに現場で試せる、実践的な<br>内容をお届けします。</p>
      </div>
    </div>
  </section>

</div>
<!-- /wp:html -->'''
    return html


def find_or_create_home_page():
    """既存『ホーム』ページがあれば返す、なければ新規作成"""
    # まず既存検索
    req = Request(f'{BASE}/wp-json/wp/v2/pages?slug=home&context=edit&_fields=id,title,status',
                  headers={'Authorization': f'Basic {auth}'})
    try:
        with urlopen(req, timeout=30) as r:
            existing = json.loads(r.read().decode())
            if existing:
                print(f"既存ホームページ発見: id={existing[0]['id']}")
                return existing[0]['id']
    except Exception as e:
        print(f"検索エラー: {e}")

    # 新規作成
    print("新規ホームページ作成中...")
    payload = json.dumps({
        'title': 'ホーム',
        'slug': 'home',
        'status': 'publish',
        'content': '',  # 後で更新
    }, ensure_ascii=False).encode('utf-8')
    req = Request(f'{BASE}/wp-json/wp/v2/pages', method='POST', data=payload,
                  headers={'Authorization': f'Basic {auth}', 'Content-Type': 'application/json; charset=utf-8'})
    with urlopen(req, timeout=30) as r:
        result = json.loads(r.read().decode())
        print(f"  ✓ 作成成功 id={result['id']}")
        return result['id']


def update_home_page(page_id):
    content = build_content()
    print(f"\nホーム固定ページ更新中（id={page_id}）...")
    payload = json.dumps({
        'title': 'ホーム',
        'content': content,
        'status': 'publish',
    }, ensure_ascii=False).encode('utf-8')
    req = Request(f'{BASE}/wp-json/wp/v2/pages/{page_id}', method='POST', data=payload,
                  headers={'Authorization': f'Basic {auth}', 'Content-Type': 'application/json; charset=utf-8'})
    with urlopen(req, timeout=60) as r:
        result = json.loads(r.read().decode())
        print(f"  ✓ 更新成功. modified={result.get('modified')}")
        print(f"  ✓ link: {result.get('link')}")
        return result


def main():
    page_id = find_or_create_home_page()
    update_home_page(page_id)

    # IDをsnapshotsに保存
    Path('/Users/shoheikoda/Documents/my-ai-company/blog/migration/snapshots/home-page.json').write_text(
        json.dumps({'page_id': page_id}, indent=2)
    )
    print(f"\n✓ home-page.json saved")
    print(f"\n次のステップ: JIN:R Customizerで show_on_front=page, page_on_front={page_id} を設定")


if __name__ == "__main__":
    main()
