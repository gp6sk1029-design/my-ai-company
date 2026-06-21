# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, '/Users/shoheikoda/Documents/my-ai-company/blog/scripts')
from wp_api import WPClient

c = WPClient.from_config()
p = c._request('GET', '/pages/756', params={'context': 'edit'})
raw = p['content']['raw']

BASE = 'https://www.ootanisatan.com'
KEYCHRON_URL = BASE + '/keychron-k1-max-%e8%a8%ad%e5%ae%9a%e7%b7%a8%ef%bd%9c1%e5%8f%b0%e3%81%a74%e9%85%8d%e5%88%97%e3%82%92%e5%88%87%e6%9b%bf%e3%81%99%e3%82%8b%e5%ae%8c%e5%85%a8%e3%82%ac%e3%82%a4%e3%83%89%ef%bd%9c%e5%b9%b421/'
GARMIN_URL = BASE + '/garmin-venu-2s-%e3%82%924%e5%b9%b4%e5%8d%8a%e4%bd%bf%e3%81%a3%e3%81%9f%e3%83%aa%e3%82%a2%e3%83%ab%e3%83%ac%e3%83%93%e3%83%a5%e3%83%bc%ef%bd%9c27%e5%86%86-%e6%97%a5%e3%81%a7%e5%81%a5%e5%ba%b7%e7%ae%a1/'

# 記事データ (url, thumb, tag, color, title, date)
brown9   = (BASE+'/braun-clean-renew-compatible-review/', BASE+'/wp-content/uploads/2026/06/braun-clean-renew-01_eyecatch.jpg', '暮らしハック', '#ea580c', 'ブラウン シェーバー洗浄液 互換品コスパ検証｜純正の約半額「シェーバークリーンNEW X」を実機レビュー', '2026.06.21')
switchbot = (BASE+'/switchbot-lock-lite-review/', BASE+'/wp-content/uploads/2026/05/switchbot-eyecatch-from-drive.jpg', 'ガジェットレビュー', '#2563eb', 'SwitchBot ロックLite レビュー｜賃貸OK、鍵を持ち歩かない生活へ', '2026.05.30')
mxergo   = (BASE+'/mx-ergo-s-settings-guide/', BASE+'/wp-content/uploads/2026/05/mx-ergo-eyecatch-2026-05-17.jpg', 'ガジェットレビュー', '#2563eb', 'MX ERGO S 設定編｜Logi Options+ で年6万円の時短を生むカスタマイズ術', '2026.05.17')
keychron = (KEYCHRON_URL, BASE+'/wp-content/uploads/2026/05/keychron-k1max-jis-setup-eyecatch.jpg', 'ガジェットレビュー', '#2563eb', 'Keychron K1 Max 設定編｜1台で4配列を切替する完全ガイド｜年21万円の時短', '2026.05.11')
garmin   = (GARMIN_URL, BASE+'/wp-content/uploads/2026/04/garmin-venu2s-eyecatch-v3.jpg', 'ガジェットレビュー', '#2563eb', 'Garmin Venu 2S を4年半使ったリアルレビュー｜27円/日で健康管理できる最強スマートウォッチ', '2026.04.04')

def feat(d):
    url, thumb, tag, color, title, date = d
    return (f'<a href="{url}" class="ot-featured-card">\n'
            f'  <div class="ot-featured-thumb" style="background-image:url(\'{thumb}\');">\n'
            f'    <span class="ot-featured-tag" style="background:{color}">{tag}</span>\n'
            f'  </div>\n'
            f'  <div class="ot-featured-body">\n'
            f'    <div class="ot-featured-title">{title}</div>\n'
            f'    <div class="ot-featured-date">🕐 {date}</div>\n'
            f'  </div>\n'
            f'</a>')

def latest(d):
    url, thumb, tag, color, title, date = d
    return (f'<a href="{url}" class="ot-latest-item">\n'
            f'  <div class="ot-latest-thumb" style="background-image:url(\'{thumb}\');"></div>\n'
            f'  <div class="ot-latest-title">{title}</div>\n'
            f'  <span class="ot-latest-tag" style="background:{color}">{tag}</span>\n'
            f'  <span class="ot-latest-date">{date}</span>\n'
            f'</a>')

featured_cards = '\n          '.join(feat(d) for d in [brown9, switchbot, garmin])
latest_cards   = '\n          '.join(latest(d) for d in [brown9, switchbot, mxergo, keychron, garmin])

# --- 注目の記事 (ot-featured-grid) 差し替え ---
g = raw.index('<div class="ot-featured-grid">')
g_end = g + len('<div class="ot-featured-grid">')
nxt = raw.index('最新の記事', g)
last_a = raw.rindex('</a>', g_end, nxt) + len('</a>')
raw = raw[:g_end] + '\n          ' + featured_cards + '\n        ' + raw[last_a:]

# --- 最新の記事 (ot-latest-list) 差し替え ---
l = raw.index('<div class="ot-latest-list">')
l_end = l + len('<div class="ot-latest-list">')
nxt2 = raw.index('記事一覧をみる', l)
last_a2 = raw.rindex('</a>', l_end, nxt2) + len('</a>')
raw = raw[:l_end] + '\n          ' + latest_cards + '\n        ' + raw[last_a2:]

# 検証
assert raw.count('ot-featured-card') == 3, raw.count('ot-featured-card')
assert raw.count('ot-latest-item') == 5, raw.count('ot-latest-item')
assert 'braun-clean-renew-compatible-review' in raw
assert 'switchbot-lock-lite-review' in raw

c._request('POST', '/pages/756', data={'content': raw})
print('更新OK')
print('注目カード数:', raw.count('ot-featured-card'), '/ 最新カード数:', raw.count('ot-latest-item'))
print('Brown9含む:', 'braun-clean-renew-compatible-review' in raw, '/ SwitchBot含む:', 'switchbot-lock-lite-review' in raw)
