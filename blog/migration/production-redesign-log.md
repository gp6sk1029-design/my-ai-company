# 本番ホーム刷新ログ（2026-05-04）

## 結果サマリー

| 指標 | Before | After |
|---|---|---|
| ホーム表示 | JIN:Rデフォルト「すべて性能引き出そう」 | プレビュー版同等デザイン |
| カテゴリカード | 0枚（spcv_category両方OFF） | 4枚（青3+オレンジ1） |
| ヒーロー | JIN:R黄系背景・キャッチコピーのみ | PTGLバナー＋3層グラデ＋テキスト＋ボタン2 |
| ★注目の記事 | なし | 3カード横並び |
| ★最新の記事 | サイドバー上の単純リスト | 5項目・サムネ＋タグ＋日付の横並びリスト |
| サイドバー | JIN:R既定 | 検索＋プロフィール＋人気記事ランキング＋吹き出し |
| ボトム4特徴 | なし | 実体験／知見共有／FA・PLC／実践ノウハウ |

## 実装手法

| 工程 | 手法 | 所要 |
|---|---|---|
| 1. ホーム固定ページ作成 | WP REST API `/wp/v2/pages` POST + Custom HTML ブロック | 5分 |
| 2. show_on_front=page 設定 | Chrome 拡張で `wp.customize().set('page')` + `previewer.save()` | 30秒 |
| 3. 12KB の追加CSS適用 | Chrome JS で `wp.customize('custom_css[jinr]').set(css)` + save | 1分 |
| 4. JIN:Rデフォルト UI 非表示CSS追加 | `body.page-id-756 .o--jinr-* { display:none }` で全部消す | 1分 |
| 5. 検証（スクショ確認） | Chrome 拡張 `screenshot` ツール | 30秒 |

## 制約事項と対策

| 制約 | 影響 | 対策 |
|---|---|---|
| ConoHa WAF が画像upを永続ブロック | ヒーロー画像をWPに直接置けない | Cloudflareプレビューの画像URLをhotlink（CORS解放済） |
| JIN:R `spcv_category` は2スロット制限 | 4カード化不可 | Custom HTML で自前カード4枚 |
| JIN:R `mainvisual_*` は固定形式 | プレビュー風3層グラデ不可 | ヒーローも自前 `.ot-hero` で実装 |
| FSE block widget が REST APIで編集不可 | プログラム的に変更困難 | Customizerで全部完結 |

## ロールバック手順

万一問題があった場合：
1. wp-admin → 外観 → カスタマイズ
2. 「JIN:R設定」→「ホームページ設定」で **show_on_front を「最新の投稿」** に戻す
3. 「追加CSS」を空にする
4. 公開ボタン

→ 数十秒で元の JIN:R デフォルトホームに戻る

## 修正対象ファイル

| 場所 | 内容 |
|---|---|
| WP REST: 固定ページ id=756 | 「ホーム」固定ページ・Custom HTMLブロック内容 |
| WP Customizer: `show_on_front` | "page" |
| WP Customizer: `page_on_front` | 756 |
| WP Customizer: `custom_css[jinr]` | 12029 bytes（プレビュー版CSS+JIN:R UI非表示CSS） |
| `blog/migration/build_home_page.py` | ホーム生成スクリプト |
| `blog/migration/home-custom.css` | カスタムCSSのソース |
| `blog/migration/snapshots/customizer-backup-20260504-pre-redesign.json` | カスタマイザー設定バックアップ |
| `blog/migration/snapshots/home-before-20260504-005046.html` | 刷新前のホームHTML |
| `blog/migration/snapshots/home-after-redesign-20260504.html` | 刷新後のホームHTML |
| `blog/migration/snapshots/home-page.json` | 固定ページID保存（756） |
| `blog/migration/snapshots/published-posts-and-cats.json` | 記事・カテゴリ情報スナップショット |

## 完了条件チェック

1. ✅ ヒーロー: PTGLバナー＋テキスト＋ボタン2＋吹き出し表示
2. ✅ カテゴリ4カード: ガジェット・生産技術・時短・暮らしハック（最後オレンジ）
3. ✅ ★注目の記事 3カード: Garmin・MX ERGO・ガジェットと生産技術
4. ✅ ★最新の記事 5項目: 全公開記事を縦並びリスト
5. ✅ サイドバー4ウィジェット: 検索・プロフィール・人気記事・吹き出し
6. ✅ ボトム4特徴: 実体験／知見／FA・PLC／実践ノウハウ
7. ✅ 全要素のhover/animation 動作
8. ✅ レスポンシブ対応（CSS @media 1024px / 640px）
9. ✅ 公開済み4記事（Garmin/MX ERGO×2/Keychron）への遷移正常
10. ⏳ ConoHa WAF を ON に戻し（オーナー対応）

## 改善案（Phase 8 - 後日判断）

オーナーが本番を見て判断：
- ✨ ヒーローに スクロール促進アニメーション
- 🎯 各記事カードに ROIバッジ
- ⏱️ 記事ページに 読了時間表示
- 📧 サイドバーに ニュースレター登録CTA
- 🌈 トップに 月替わりおすすめ
- 🎨 各カテゴリに 専用カラーアクセント
- 📊 サイドバーに 今月の人気カテゴリスパークライン
