# 献立くん（料理レシピ献立アプリ）SKILL.md

## 自己改善ループ（CLAUDE.mdに準拠）

このエージェント／プロジェクトは `../../CLAUDE.md` の社内ルールに従い、
タスク完了のたびに振り返りレポートを出力し、
SKILL.md と MEMORY.md を更新し続ける。
ROI評価を毎回行い、費用対効果を最大化する。

---

## プロジェクト概要

| 項目 | 値 |
|---|---|
| 部門 | 私生活（private） |
| 種別 | PWA（Web + Cloudflare Pages Functions） |
| 目的 | 家族構成・旬・在庫を考慮した時短献立を自動生成し「今日何作る？」の迷い時間を削減 |
| AI | Google Gemini 2.5 Flash（生成＋Vision） |
| 月額コスト目安 | 約 2〜5円（想定利用頻度） |

---

## 【最重要】献立生成の5原則

1. **時短優先** — デフォルト調理時間20分以内。朝食は10分以内。
2. **簡単な材料** — スーパーで買える基本食材ホワイトリスト方式。輸入スパイス・専門店食材は禁止。
3. **ため買い前提** — 日持ちの長短で食材を配置し、最終日は「使い切りメニュー」。
4. **学習する** — 評価（⭐/🙂/👎）を蓄積し、好評レシピを状況判断で再登場。
5. **在庫活用** — カメラ撮影→Gemini Vision で食材認識→在庫優先の献立を生成。

---

## クイックリファレンス（開発・運用の禁忌）

- **家族メンバー0人で献立生成しない** — 献立条件が組めないため必ずエラー。
- **アレルギー食材は必ず全員分の和集合で除外** — 誤提案は重大事故。サーバ側（プロンプト）＋クライアント側（生成結果のダブルチェック）両方で検証。
- **Gemini API キーを公開側（config.js、クライアント）に絶対置かない** — Cloudflare Pages 環境変数 `GEMINI_API_KEY` のみ。
- **👎評価は恒久除外** — 解除はレシピ詳細モーダルの「除外解除」ボタンから明示的に。
- **直近14日以内に作ったレシピは再登場させない** — マンネリ回避のため。
- **調理したら必ず「🍳 今日 作った！」ボタンで履歴を残す** — 学習の入力になる。
- **画像は1280pxに縮小してから送信** — Cloudflare Workers のリクエストサイズ節約＋Vision コスト削減。

---

## 工程フロー

```
（初回）家族メンバー登録 → 設定の避け方モード確認
         ↓
（毎回）モード選択（条件から / 冷蔵庫から）
         ↓
   [条件]日数・食事タイプ・時間上限・気分・トグル設定
   [カメラ]冷蔵庫を3〜5枚撮影 → Gemini Vision で認識 → 確認画面で調整
         ↓
  Gemini 2.5 Flash で献立生成（JSON スキーマ強制）
         ↓
  アレルギー再チェック → カード表示（時短バッジ・使い切り・お気に入り）
         ↓
  個別保存 or まとめて保存 / 買い物リスト追加（在庫分は除外）
         ↓
  調理したら「作った！」→ 評価付与 → 次回の学習材料に
         ↓
  SKILL.md / MEMORY.md の振り返り記録
```

---

## コスト監視ルール

- 月次で Google Cloud Console の **Generative Language API** 課金を確認
- 月額 50円を超えた月は MEMORY.md に原因と対策を追記
- 画像枚数（Vision）が想定の 2倍以上になった月は「撮影推奨枚数 3〜5枚」の注意書きを UI に強化

---

## 学習データの運用ルール

- `cookHistory` は月1回棚卸し
- 3ヶ月以上作っていない元お気に入りはアーカイブ化（blocked にはしない、単に favorites 候補から外す）
- `generations` キャッシュは30日以上古いものを削除

---

## アーキテクチャ決定の記録（ADR 相当）

| 決定 | 理由 |
|---|---|
| バックエンドは Cloudflare Pages Functions のみ | APIキー秘匿のため。D1/KV は MVP では不要（個人利用・単端末） |
| IndexedDB でクライアント永続化 | 同期不要・オフライン動作・シンプル |
| 旬食材は静的 JSON | Gemini リクエスト削減（月0.5倍コスト） |
| 画像は 1280px に縮小 | Vision API コスト削減＋帯域節約 |
| 出力は Gemini responseSchema で構造化強制 | 後処理の JSON パースエラーを激減 |

---

## 分離トリガー

- 1ファイル 500 行を超えたら分割（現在 app.js が最大、機能追加時は module 分割を検討）
- Phase 2 で D1 同期を追加する場合は `functions/api/sync.js` を新規作成

---

## 検証（Verification）

```bash
# ローカル起動
cd /Users/shoheikoda/Documents/my-ai-company/private/cooking-recipe
export GEMINI_API_KEY='your-key-here'
npx wrangler pages dev public --compatibility-date=2024-11-01
# → http://localhost:8788 でアクセス

# Gemini 生成 API の疎通確認
curl -X POST http://localhost:8788/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"month":4,"members":[{"name":"たろう","kind":"adult","age":35}],"householdAllergies":[],"avoidMode":"any","budgetYen":1500,"maxCookTimeMin":20,"moodTag":"normal","seasonalHint":["春キャベツ","新玉ねぎ"],"days":1,"mealTypes":["dinner"],"basicIngredientsOnly":true,"batchShopping":false}'

# PWA インストール検証: iPhone Safari で開く → 共有 → ホーム画面に追加
```

---

## 進化の記録

### v1.0 初期リリース（2026-04-22）
- 4タブPWA（ホーム／レシピ／買い物／冷蔵庫／家族）
- Gemini 2.5 Flash で献立生成（構造化JSON出力）
- Gemini Vision で冷蔵庫写真から食材認識
- 家族メンバー別（嫌い・好き・アレルギー）設定
- 日数1〜7、食事タイプ選択、時短優先、ため買いモード
- 評価学習機能（⭐/🙂/👎）＋14日以内のマンネリ回避
- 買い物リスト自動集約＋保存別グループ化
