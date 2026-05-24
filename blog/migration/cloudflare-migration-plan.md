# 「生産技術ガジェット研究所」Cloudflare移設プラン詳細書

| 項目 | 内容 |
|---|---|
| 作成日 | 2026-05-02 |
| 作成者 | ブログ統括PDM（Claude Code） |
| 対象サイト | https://www.ootanisatan.com |
| 移設元 | ConoHa WING + WordPress + JIN:R |
| 移設先 | Cloudflare Pages（無料）+ Local WordPress（編集用ローカル環境） |
| 想定読者 | エンジニア相談相手＋オーナー本人 |

---

## 0. このドキュメントの使い方

このドキュメントを**そのままエンジニアに渡してください**。本文書は以下を含んでいます：

1. なぜ移設したいか（背景・目的）
2. 現状の構成（既存資産インベントリ）
3. 目指す構成（移設後のアーキテクチャ）
4. 段階的な移設手順（安全ゲート付き）
5. リスクレジスタ（致命的・大・中・小）
6. **エンジニア相談ポイント**（どの作業を依頼すべきか・赤枠）
7. オーナー本人が事前にできる準備
8. 切り戻し手順（事故時の復旧）
9. 移設後の運用ルール変更

---

## 1. 移設の目的（なぜやるか）

### 1.1 オーナーの希望
- **完全無料での運営**を実現したい（コノハWING月額コストをゼロに）
- WordPress + JIN:Rでの編集体験を**現状に近い形**で維持したい
  - 装飾・テーマデザインは「形だけ」でも代替可（オーナー回答済み）
  - 編集UIはwp-adminを継続使用したい

### 1.2 PDMの判断
- 「WordPressをそのままCloudflareに動かす」ことは技術的に不可能
  - Cloudflare WorkersはPHPを動かせない
  - Cloudflare D1はMySQL互換ではない
- 解として「ローカルでWordPress編集 → 静的HTMLに書き出し → Cloudflare Pagesに公開」を採用
  - 編集体験：ほぼ100%維持（wp-admin・JIN:Rが手元PCで動く）
  - 公開コスト：完全無料
  - ただし**動的機能は失う**（後述）

---

## 2. 現状の構成（移設元）

### 2.1 公開サイト
- **URL**: https://www.ootanisatan.com
- **ホスティング**: ConoHa WING（PHP + MySQL）
- **WordPress**: 稼働中
- **テーマ**: JIN:R
- **既存記事**: 確認済み2件（公開・下書き混在）
  - 605: Garmin Venu 2S レビュー（公開）
  - 703: HUAWEI GT Runner 2 レビュー（下書き）
  - その他の記事は要棚卸し（章10参照）

### 2.2 ローカル開発環境（既存資産・継続利用予定）

```
my-ai-company/
├── blog/
│   ├── SKILL.md              # ブログ部門ルール
│   ├── MEMORY.md             # 学び蓄積
│   ├── config.json           # WP接続情報・APIキー（.gitignore済）
│   ├── articles/             # ローカルMarkdown原稿
│   ├── images/               # 記事用画像
│   ├── scripts/
│   │   ├── wp_api.py         # WP REST APIクライアント（要改修）
│   │   ├── wp_block_builder.py  # JIN:R向けブロック生成
│   │   ├── article_status.py    # 記事曖昧検索
│   │   ├── image_resizer.py     # 2000px以下リサイズ
│   │   └── run_pipeline.py
│   ├── pwa-cloudflare/       # 記事めしPWA（Cloudflare Pages）
│   │   └── （HTML/CSS/JS）
│   └── apps-script/blog-capture/  # GAS バックエンド
│       └── Code.gs
└── sns/                      # SNS統括基盤（2026-05-02新設）
```

### 2.3 既存ツール群の役割（移設後の影響範囲）

| ツール | 機能 | 移設後の状態 |
|---|---|---|
| wp_api.py | ConoHa WPのREST APIへ投稿・取得 | ⚠️ 接続先をlocalhost:WPに変更が必要 |
| wp_block_builder.py | Markdown→JIN:R HTMLブロック変換 | ✅ そのまま使える |
| article_status.py | 記事曖昧検索（ローカル+WP統合） | ⚠️ WP連携部のURL変更が必要 |
| 記事めしPWA | Drive画像→GAS→ConoHa WP REST API投稿 | ⚠️ 投稿先URLをlocalhostに変更必要 |
| image_resizer.py | 画像リサイズ | ✅ そのまま使える |

### 2.4 ドメイン
- `ootanisatan.com` の登録レジストラを要確認（章7「事前準備」参照）
- DNS設定は現在ConoHaが管理している可能性が高い

### 2.5 想定コスト（現状）
| 項目 | 月額 |
|---|---|
| ConoHa WING ベーシックプラン | 約1,000〜1,500円 |
| ドメイン名（.com） | 約100〜200円相当（年間1,500円程度） |
| **合計** | **約1,200〜1,700円/月（年間約14,000〜20,000円）** |

---

## 3. 目指す構成（移設先）

### 3.1 全体アーキテクチャ図

```
┌─────────────────────────────────────────┐
│ オーナーのPC（macOS）                    │
│                                          │
│  ┌─────────────────┐                    │
│  │ Local WordPress  │  ←── 編集はここ  │
│  │ (Local by Flywheel)               │
│  │ - JIN:Rテーマ     │                    │
│  │ - wp-admin編集    │                    │
│  │ - Application Pw  │                    │
│  └─────────────────┘                    │
│         │                                │
│         │ ① REST API（既存ツール群）     │
│         ↓                                │
│  ┌─────────────────┐                    │
│  │ 記事めしPWA      │                    │
│  │ wp_api.py        │                    │
│  │ wp_block_builder │                    │
│  └─────────────────┘                    │
│         │                                │
│         │ ② 公開ボタン                   │
│         ↓                                │
│  ┌─────────────────┐                    │
│  │ 静的書き出し     │                    │
│  │ (Simply Static等)│                    │
│  └─────────────────┘                    │
│         │                                │
└─────────┼────────────────────────────────┘
          │ ③ 自動デプロイ
          ↓
   ┌──────────────────────┐
   │ Cloudflare Pages（無料）│
   │ - HTML/CSS/JS/画像配信  │
   │ - DDoS対策・CDN・SSL    │
   │ - カスタムドメイン      │
   └──────────────────────┘
          ↑
          │ 読者アクセス
   https://www.ootanisatan.com
```

### 3.2 想定コスト（移設後）

| 項目 | 月額 |
|---|---|
| Cloudflare Pages | **0円** |
| Local for WordPress（PCソフト） | **0円** |
| ドメイン名（.com） | 年間1,500円（変わらず） |
| Cloudflare Registrar移管なら原価維持・更新割引あり | 年間1,500円程度 |
| **合計** | **約125円/月（年間1,500円）** |

→ **年間約14,000〜18,500円のコスト削減**

### 3.3 失う機能・代替案

| 失う機能 | 影響度 | 代替案 |
|---|---|---|
| WordPressコメント | 中 | Disqus（無料）／コメント無効化 |
| サイト内検索 | 中 | Pagefind（オープンソース・静的検索） |
| お問い合わせフォーム | 大 | Cloudflare Formsまたはフォームラン無料 |
| 関連記事自動表示 | 小 | 静的書き出し時に固定化（書き直すまで更新されない） |
| PV計測 | 小 | Google Analytics（既導入なら不変） |
| WP管理画面ログイン認証 | - | 公開サイトに不要（ローカルだけで使う） |
| プラグイン自動更新 | 中 | ローカルWPで自分で更新 |
| メディアライブラリ管理 | 小 | ローカルWPで継続使用可 |

---

## 4. 段階的な移設手順（5ステップ・安全ゲート付き）

### Step 1：ローカルWordPress構築（ローリスク・自分でも可能）
**所要時間**：2〜3時間

1. **Local for WordPress**（無料アプリ）をオーナーPCにインストール
   - https://localwp.com/
2. 新規サイト作成：サイト名「ootanisatan-local」
3. JIN:Rテーマをインストール（ライセンスはコノハで購入済みの可能性あり・要確認）
4. ConoHaから既存サイトを完全バックアップ
   - **All-in-One WP Migration**（プラグイン・無料）でエクスポート
   - エクスポートファイル（.wpress）をPCに保存
5. ローカルWPに同プラグインを入れインポート
6. ローカルWPで `http://ootanisatan-local.local` 等で表示確認

🛡️ **安全ゲート**：ローカルでサイトが完全に表示できればOK。**この時点でConoHaは触らない**。

### Step 2：静的書き出しプラグイン導入とテスト
**所要時間**：1〜3時間

1. ローカルWPに **Simply Static**（無料版または Pro版）をインストール
2. 設定で出力先を `/Users/shoheikoda/Documents/my-ai-company/blog/static-output/` に指定
3. 全記事を静的HTMLに書き出し
4. ローカルブラウザで `static-output/index.html` を開いて表示確認
5. 装飾・JIN:Rデザイン・画像が崩れていないか目視確認

⚠️ **既知の落とし穴**：
- 一部のJIN:R独自ブロックで装飾が消える可能性 → 章6リスクレジスタ参照
- 画像URLが `localhost` のまま残ることがある → プラグイン設定で本番URLへ書き換え必須

🛡️ **安全ゲート**：静的書き出しの結果が現状サイトと**同等品質**でなければ次に進まない。
不一致があれば、プラグイン設定の調整・有料版検討・代替プラグイン（WP2Static）検討。

### Step 3：Cloudflare Pages にプレビュー公開（**🚨ここから要エンジニア相談**）
**所要時間**：3〜5時間（エンジニア作業含む）

1. Cloudflareアカウント作成（既にあれば既存利用）
2. **GitHubリポジトリを別途新設**（例：`ootanisatan-blog-static`）
3. `static-output/` の中身をそのリポジトリへpush
4. Cloudflare Pagesでリポジトリを連携・自動デプロイ設定
5. プレビューURL（`xxx.pages.dev`）でアクセスして表示確認

🚨 **エンジニア相談ポイント**：
- リポジトリPrivate化（CLAUDE.mdグローバルルール準拠）
- GitHub Actions or Cloudflare Pagesビルド設定（リポジトリpushでオート公開）
- カスタムドメイン適用前の表示確認

🛡️ **安全ゲート**：プレビューURLで全記事が問題なく表示できるまで、本番ドメイン切替えはしない。

### Step 4：本番ドメイン切替（**🚨🚨🚨最大の危険ポイント・エンジニア必須**）
**所要時間**：1〜3時間（事前準備込みで半日確保）

🚨 **このステップを誤ると、サイトが数時間〜数日見えなくなり、検索順位が壊滅する可能性あり**

1. **事前作業**：
   - 全記事のURL一覧を取得（ConoHa側からエクスポート）
   - 静的書き出し後のURL構造と完全一致しているか照合
   - 不一致記事は静的書き出しプラグイン設定で修正
2. **ドメイン管理元の確認**：
   - レジストラ（お名前.com・コノハ・ムームー等）にログインできるか
   - DNSレコードを編集できるか
3. **CloudflareのカスタムドメインにOOTanisatan.comを設定**：
   - DNS追加
   - SSL証明書発行（自動）
4. **DNS切替**：
   - レジストラ管理画面で、ネームサーバーをCloudflareのものに変更
   - **反映に最大48時間かかる**ため、深夜帯〜土日の作業推奨
5. **301リダイレクト確認**：
   - 旧URL（コノハ側）→ 新URL（Cloudflare側）が同一構造であれば不要
   - 異なる場合は **`_redirects` ファイル**でCloudflare Pagesにリダイレクト設定
6. **Search Console再申請**：
   - Google Search Consoleで「サイト所有権の確認」を再実施
   - サイトマップを再送信

🛡️ **安全ゲート**：DNS切替後24時間は全記事の表示確認を毎日実施。

### Step 5：ConoHa解約（**待機期間後**）
**所要時間**：30分

1. **DNS切替後、最低1ヶ月は様子見**（Search Console・PVを観察）
2. 全記事が正常表示・検索順位に大きな低下なしを確認
3. ConoHa WINGプランを解約
4. ConoHa側のWordPressデータをローカルに最終バックアップ（保険）

🛡️ **絶対禁止**：DNS切替直後にConoHa解約しないこと。**切り戻し時に復旧できなくなる**。

---

## 5. 既存ツール群の改修（PDMが対応可能）

### 5.1 wp_api.py
**変更内容**：
- `config.json` の `wordpress_url` を `http://ootanisatan-local.local`（ローカルWP）に変更
- 接続先がローカルになるため、HTTPS必須チェックを緩和

```python
# config.json の変更例
{
  "wordpress_url": "http://ootanisatan-local.local",
  "wordpress_url_production": "https://www.ootanisatan.com",  # 表示用
  "wp_auth": { ... }  # ローカルWPのApplication Passwordを再生成
}
```

### 5.2 記事めしPWA
**変更内容**：
- GAS（`blog/apps-script/blog-capture/Code.gs`）で WordPress投稿先URLを変更
- ⚠️ ローカルWP（PC内）にGASからは直接接続できない
- 解決策：GASは画像格納のみ担当し、WordPress投稿はローカルPC側スクリプト（wp_api.py）が担う

→ **記事めしPWAの役割再設計が必要**（画像アップロード→Drive保存まで・WP投稿はPCが担当）

### 5.3 article_status.py
**変更内容**：
- WP REST API接続先をローカルに切替
- `--with-wp` オプション利用時にローカルWPが起動していないとエラー

### 5.4 SNS連携（sns/部門）
**変更内容**：
- ブログ記事公開後のURLは https://www.ootanisatan.com/xxx で変わらない
- SNS原稿生成スクリプトの記事URL生成ロジックは**変更不要**

---

## 6. リスクレジスタ

| ID | リスク | 影響度 | 発生確率 | 対策 |
|---|---|---|---|---|
| R1 | DNS切替ミスでサイトが数日見えない | 🔴致命的 | 中 | 深夜帯作業・直前バックアップ・エンジニア立会 |
| R2 | URL構造変化でSEO壊滅 | 🔴致命的 | 中 | URL一覧の事前照合・301リダイレクト設定 |
| R3 | JIN:R独自ブロックが静的書き出しで崩れる | 🟠大 | 中 | Step 2で全記事目視確認・崩れたら手動修正 |
| R4 | コメント機能の喪失 | 🟡中 | 100% | Disqus導入またはコメント無効化を事前決定 |
| R5 | 画像URLがlocalhostのまま残る | 🟠大 | 中 | プラグイン設定でURL置換ルールを設定 |
| R6 | 記事めしPWAが動かなくなる | 🟡中 | 高 | 移設前にGASとPC側スクリプトの分業設計を完了 |
| R7 | ローカルWP起動忘れでwp_api.pyエラー | 🟢小 | 高 | スクリプトに「localhost到達確認」を冒頭に追加 |
| R8 | Local for WordPressがmacOSアップデートで動かなくなる | 🟡中 | 低 | 公式情報追跡・代替（XAMPP等）の事前確認 |
| R9 | ドメインのレジストラ切替トラブル | 🟠大 | 中 | レジストラ移管を急がず、DNSだけ先に切替する選択肢あり |
| R10 | バックアップ失敗で記事消失 | 🔴致命的 | 低 | 複数手段でバックアップ（プラグイン・FTP・MySQL） |
| R11 | Cloudflare無料枠の上限超過 | 🟢小 | 低 | 無料枠 = 月500MBビルド・100,000リクエスト/日。個人ブログでは到達困難 |
| R12 | Search Console認証情報の喪失 | 🟡中 | 低 | Googleアカウントに紐づくため事前ログイン確認 |

---

## 7. オーナー本人ができる事前準備（エンジニア相談前にやっておく）

### 7.1 情報棚卸し（30分）
以下をエンジニアに伝えるため、紙またはメモにまとめる：

- [ ] ConoHa WINGのログイン情報（ID・パスワード）
- [ ] WordPressのadminログイン情報（ユーザー名・パスワード）
- [ ] ドメイン `ootanisatan.com` のレジストラ（どこで取得したか）
- [ ] ドメイン管理画面のログイン情報
- [ ] Google Search Console利用の有無・ログイン情報
- [ ] Google Analytics利用の有無・トラッキングID
- [ ] JIN:Rの購入時のレシート・ライセンス情報（再インストール時必要）
- [ ] 既存記事の総数（ConoHa WP管理画面で確認）

### 7.2 バックアップ（1時間・PDMサポート可）
- [ ] **All-in-One WP Migration** プラグインで全データを `.wpress` ファイル化
- [ ] バックアップを **3箇所**に保存（PC・外付けSSD・Google Drive等）
- [ ] MySQL データベースを phpMyAdmin から `.sql` ファイルでも別途エクスポート

### 7.3 環境準備（30分）
- [ ] Cloudflareアカウント作成（無料）
- [ ] GitHubアカウント作成（無料）
- [ ] Local for WordPress をPCにインストール

---

## 8. エンジニア相談時に伝えるべきこと

### 8.1 オーナーの希望
「コノハWINGからCloudflareに移設して完全無料にしたい。WordPress + JIN:Rで編集する体験はローカルWPで維持する方向で考えている。**ただし致命的な作業はサポートしてほしい**。」

### 8.2 依頼したい具体作業（赤枠）
1. **DNS切替作業**（R1対策）
2. **URL構造の照合と301リダイレクト設定**（R2対策）
3. **Cloudflare Pages のビルド設定・GitHub連携**
4. **静的書き出しプラグインの選定アドバイス**（無料版で足りるか・Pro版必須か）
5. **JIN:R独自ブロックの静的化挙動チェック**
6. **記事めしPWAのGAS↔ローカルWP分業設計レビュー**

### 8.3 渡すもの
- 本ドキュメント全体
- 章7で棚卸しした情報一覧
- 既存記事一覧（記事数・URL構造サンプル）

### 8.4 確認すべき技術判断
- ドメインレジストラを Cloudflare Registrar に移管するか・現状維持か
- Cloudflare PagesのビルドはGitHub Actionsで自動化するか・手動アップロードか
- バックアップ復旧手順を最初に1度通しでテストするか
- ローカルWPのMySQLバックアップ自動化を仕掛けるか

---

## 9. 切り戻し手順（事故時の復旧）

### Case A：DNS切替直後にサイトが見えない
1. **Cloudflareの管理画面でDNSをコノハの旧設定に戻す**
2. 反映待ち（最大48時間）
3. ConoHa側のサイトを再確認

### Case B：Cloudflareでサイトが見えるが記事の一部が崩れている
1. ConoHa側を残したままなので**慌てずローカルで修正**
2. 静的書き出しプラグインの設定見直し
3. 再度Cloudflareにデプロイ

### Case C：1ヶ月後にSEO評価が大きく下がっている
1. Search Consoleで該当記事のインデックス状態を確認
2. URL構造の不一致が原因なら301リダイレクト追加
3. 必要に応じて再申請・サイトマップ再送信

### Case D：データ消失
1. Step 1のバックアップ（.wpressファイル）からローカルWPに復元
2. 既存PC内のローカルWPで動作確認
3. 静的書き出し → 再デプロイ

---

## 10. 移設後の運用ルール変更

### 10.1 編集フローの変化

**Before（現在）**：
1. ブラウザで `https://www.ootanisatan.com/wp-admin` を開く
2. JIN:Rで記事を書く
3. 公開ボタンを押す → 即時公開

**After（移設後）**：
1. PCで Local for WordPress を起動
2. ブラウザで `http://ootanisatan-local.local/wp-admin` を開く
3. JIN:Rで記事を書く
4. 公開ボタンを押す
5. 静的書き出しプラグインで「Generate」を実行
6. （自動 or 手動）Cloudflare Pagesに反映 → 公開

→ **ステップ数が増える分、エディタプラグインで「公開ボタン1発」化を後日設計**

### 10.2 SKILL.md/MEMORY.mdへの反映

移設完了後、以下のファイルを更新：

- [ ] `blog/skills/technical.md` §0 PROMPT.md優先ルール — 変更不要
- [ ] `blog/skills/research-publish.md` §11 WordPress投稿ルール — 「ローカルWP前提」を追記
- [ ] `blog/MEMORY.md` — 移設記録・新運用ルールを記載
- [ ] `CLAUDE.md` — 「ブログ部門の編集フロー」をローカルWPベースに更新
- [ ] `sns/SKILL.md` — 変更不要（公開URL不変のため）

> 📌 2026-05-24: blog/SKILL.md が4ファイル構成（SKILL.md + skills/writing.md + skills/research-publish.md + skills/technical.md）に分離されたため、参照パスを新構造に更新済み。

---

## 11. 移設タイムライン目安

| 週 | 内容 | 担当 |
|---|---|---|
| 第1週 | 章7「事前準備」完了 | オーナー |
| 第2週 | エンジニア相談・本ドキュメントレビュー | オーナー＋エンジニア |
| 第3週 | Step 1（ローカルWP構築） | オーナー＋PDMサポート |
| 第4週 | Step 2（静的書き出しテスト） | オーナー＋PDMサポート |
| 第5週 | Step 3（Cloudflareプレビュー公開） | エンジニア＋PDMサポート |
| 第6週 | Step 4（DNS切替） | **エンジニア主導** |
| 第7-10週 | 様子見期間（Search Console・PV観察） | オーナー＋PDM |
| 第11週 | Step 5（ConoHa解約） | オーナー |

---

## 12. 関連リソース

### 12.1 既存ドキュメント
- `CLAUDE.md` — 全体ルール（v3.0）
- `blog/SKILL.md` — ブログ部門の目次（クイックリファレンス・分離トリガー）
- `blog/skills/writing.md` — §1-6, §14-16 執筆ルール
- `blog/skills/research-publish.md` — §7-13 リサーチ・SEO・校正・公開（§11 WordPress投稿）
- `blog/skills/technical.md` — §0 + §17 + §18 技術運用（§0 PROMPT.md・JIN:R・wp_block_builder）
- `blog/MEMORY.md` — 学習蓄積
- `~/.claude/CLAUDE.md`（オーナー個人ルール） — Cloudflare構成ルール

### 12.2 外部参考リンク
- Local for WordPress: https://localwp.com/
- Simply Static: https://wordpress.org/plugins/simply-static/
- Cloudflare Pages: https://pages.cloudflare.com/
- All-in-One WP Migration: https://wordpress.org/plugins/all-in-one-wp-migration/
- Pagefind（静的検索）: https://pagefind.app/

### 12.3 関連プラン
- SNS統括基盤プラン: `~/.claude/plans/cozy-wondering-alpaca.md`

---

## 改訂履歴

| 日付 | 改訂内容 | 改訂者 |
|---|---|---|
| 2026-05-02 | 初版作成 | ブログ統括PDM |
