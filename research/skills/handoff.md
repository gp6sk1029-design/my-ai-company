---
title: リサーチ｜他部門連携ルール
aliases:
  - 他部門連携
  - handoff
---

# 他部門連携ルール
# research部門 → blog/sns/tools/life-plan への送出フロー

> ⚠️ このファイルは **他部門連携の中核ルール** です。
> 全体像・クイックリファレンスは [research/SKILL.md](../SKILL.md) を参照。
> 収集は [collect.md](collect.md)、掛け合わせは [synthesize.md](synthesize.md)、自動化提案は [automate.md](automate.md) を参照。

---

## §0. このファイルの役割と読むタイミング

synthesize.md（掛け合わせ）・automate.md（自動化提案）の出力を **他部門に正しく渡すとき** に必読。
編集権限ルール・送出フォーマット・上限管理を定義する。

---

## §1. 他部門連携の全体マップ

| 渡したいもの | 振り先部門 | 渡し方 | ファイル |
|---|---|---|---|
| 記事ネタ案（A×B掛け合わせ） | blog | TODO追記のみ（記事は書かない） | `blog/MEMORY.md`「他セッションへのTODO」 |
| SNS投稿ネタ | sns | アイデアメモ追記 | `sns/calendar.md`「💡アイデアメモ」 |
| **🤖 自動化案件** | **tools** | **案件台帳追記** | **`tools/MEMORY.md`「🤖 research由来の自動化案件」** |
| メルカリ改善ヒント | tools/ec | TODO追記 | `tools/ec/MEMORY.md`「🔬 research由来TODO」 |
| 献立くん改善 | tools/cooking-recipe | TODO追記 | `tools/cooking-recipe/MEMORY.md` 同上 |
| life-plan改善 | tools/life-plan | TODO追記 | `tools/life-plan/MEMORY.md` 同上 |
| 副業収入シミュ | tools/life-plan | 手動入力（Phase 1） | life-plan PWAライフイベントへ転記 |
| 高配当株ポートフォリオ記録 | tools/life-plan | 🔬TODO追記（記録・可視化のみ／投資助言NG） | `tools/life-plan/MEMORY.md`「🔬 research由来TODO」 |
| 学長メソッドの蓄積 | research自身 | 台帳追記（私的利用） | `research/MEMORY.md`「学長メソッド蓄積台帳」 |
| 自分の副業着手 | research自身 | ポートフォリオ追記 | `research/MEMORY.md`「マイ副業ポートフォリオ」 |

---

## §2. blog部門への受け渡し（記事ネタ供給）

### 🚨 送出前必須：ユーザー判断（規約適合性確認）

リベシティ利用規約（禁止#12 二次配布禁止・禁止#9 広告宣伝目的禁止）の関係で、blog/sns送出時は **必ずユーザーに事前確認** する。

```
ユーザー確認テンプレ：
「このネタ案をblog部門に送出します。
記事化する際は『リベシティのノウハウから着想を得た』形ではなく、
ユーザー自身の言葉でオリジナル文章として書く前提でよろしいですか？」
```

ユーザー承認後にのみ送出。承認なしでは送出禁止。

### 振り先
`blog/MEMORY.md`「他セッションへのTODO」セクションに追記

### 形式
```markdown
- [ ] [research由来 2026-XX-XX] 記事ネタ「副業A×Bモデル」
  根拠: research/MEMORY.md アイデア#12
  推定金額: 年間XX万円 / 推定時給: XXXX円
  対象読者: 工場勤務30代の副業初心者
  4軸スコア: XX/20
```

### NG
- `blog/articles/draft/` に直接Markdownを書き出す
- blog/SKILL.md §15「承認フロー」を飛ばす

### 理由
blog部門は「企画レビュー → 記事レビュー → 改善レビュー」の3回チェックを必須化している。
research側が記事を書いてしまうと企画レビューが飛ばされ、blog部門のスキル運用が崩れる。
**「ネタの提供」と「記事の執筆」は明確に分離**する。

---

## §3. SNS部門への受け渡し（投稿ネタ供給）

### 🚨 送出前必須：ユーザー判断（規約適合性確認）
§2と同じく、SNS送出時もユーザー事前確認必須。
リベシティ規約抵触を避けるため、ユーザー自身の言葉でオリジナル投稿する前提を確認してから送出。

### 振り先
`sns/calendar.md`「💡 アイデアメモ（着手未定）」セクションに追記

### 形式
```markdown
### 💡 アイデアメモ（着手未定）
- [research由来 2026-XX-XX] 「副業で月3万を最低賃金から最速到達する3ステップ」
  根拠: research/MEMORY.md アイデア#7
  数字の素材: 月収3万円・時給1,500円・1日30分
```

### NG
- 投稿型（数字型/裏話型/口コミ型）の指定をresearch側で決める
- sns/channels/*/SKILL.md の編集

### 理由
投稿型・チャネル選定はSNSセッションの責任範囲。
research側は「ネタ素材」を渡すだけ。

---

## §4. tools部門への改善ヒント（既存ツール強化）

小さな改善ヒント（自動化案件ほどの規模ではない）は、各ツールのMEMORY.mdに追記。

### 振り先
- `tools/ec/MEMORY.md`「🔬 research由来TODO」セクション
- `tools/cooking-recipe/MEMORY.md` 同上
- `tools/life-plan/MEMORY.md` 同上

### 形式
```markdown
## 🔬 research由来TODO

- [ ] [2026-XX-XX] リベシティ記事ID:XXXX より「メルカリ売れる時間帯は21-23時」
  → 出品スケジュール機能の追加検討
  根拠: research/MEMORY.md アイデア#15
```

### 自動化案件との違い
| 項目 | 改善ヒント | 自動化案件 |
|---|---|---|
| 規模 | 小（既存機能の調整） | 中-大（新機能追加 or 新ツール） |
| 振り先 | 各ツールMEMORY.md | tools/MEMORY.md（中央） |
| フォーマット | 1行TODO | 提案書テンプレ完全埋め |
| 4軸スコア | 不要 | 必須（15点以上で送出） |

---

## §X. 自動化案件 → tools部門 連携フロー（最重要・新規）

automate.md §9 で完成した「自動化提案書」を `tools/MEMORY.md` へ送出する専用フロー。
通常のTODO追記より構造化された「案件台帳エントリ」として記録する。

### 送出条件
- automate.md §14 **全YES**（8項目チェックリスト）
- かつ **4軸15点以上**

両方を満たさない案件は research/MEMORY.md「🤖 自動化提案台帳」内で「保留中」マーク。

### 送出先
- **ファイル**: `tools/MEMORY.md`
- **セクション**: 「🤖 research由来の自動化案件」（CLAUDE.md改訂で新設）

### 送出フォーマット（コピペ用）

```markdown
### 案件 #NN：__案件名__（受領日 2026-XX-XX）

- **出典**: research/MEMORY.md 自動化提案台帳#NN（記事台帳#YY）
- **記事URL**: https://...
- **推奨アーキ**: パターン__A/B/C/D__
- **拡張 or 新規**: __既存tools/XX拡張__ / __新規ツールtools/YY新設__
- **推定実装工数**: __時間（時給950円換算で円）__
- **月削減時間**: __H__ / **月削減金額**: __円__
- **月運用コスト**: __円__
- **損益分岐**: __ヶ月__
- **4軸スコア**: __XX/20点__
- **risk-flag**: __法規制/重複/暴走__ の該当有無
- **tools側ステータス**: [ ] 未着手 / [ ] 検討中 / [ ] 採用（実装中）/ [ ] 不採用
- **不採用時の理由記入欄**: __（tools側が記入）__
```

### 既存ツール拡張 vs 新規ツール作成の使い分けルール

| 状況 | 振り先 |
|---|---|
| メルカリ・物販系 | tools/ec 拡張（mercari_browser.py 系流用） |
| 食事・家計・家族向け | tools/cooking-recipe 拡張 |
| 金融・資産・副業収入シミュ | tools/life-plan 拡張 |
| WordPress・記事執筆・SEO | blog/scripts 拡張（tools/ ではない） |
| 上記いずれにも当てはまらない | 新規ツール `tools/__新規名__` 提案 |

### 編集権限（マルチセッション運用ルール準拠）

- research セッションは `tools/MEMORY.md` の「🤖 research由来の自動化案件」セクションへの **追記のみ**
- 案件の「採用/不採用/実装中」ステータス更新は **tools セッションの専権**
- 一度送出した案件を research 側から取り下げる場合は、tools/MEMORY.md の該当行に **「取り下げ希望（理由）」を追記**し、tools側が削除を判断する（直接削除しない）

---

## §5. tools/life-plan PWA への副業収入連携

Phase 1では **手動入力**（life-plan PWAの「ライフイベント」または「収入」フォームに転記）。

### 渡す数値
- 開始年齢
- 月収レンジ（中央値）
- 月次工数
- 想定継続年数
- 確度（高/中/低）

### Phase 2以降
将来的にAPIで連動するなら、tools部門の改修案件として `tools/life-plan/MEMORY.md` に「🔬 research由来TODO」で要望提出。

### 高配当株ポートフォリオ記録の連携（digest.md §6）

学長の高配当株メソッド（research側で要約）を踏まえ、自分の保有株の「記録・可視化」は life-plan に持たせる。

🚨 **投資助言NG**：life-planに渡すのは「記録・計算・可視化」の要望のみ。「買うべき／この配分に／買い時」等の助言機能は要望しない（CLAUDE.md安全ルール／automate.md §12）。

- **渡す要望**: 銘柄・株数・取得単価・配当・業種の記録UI、年間配当合計・平均利回り・セクター分散の可視化
- **振り先**: `tools/life-plan/MEMORY.md`「🔬 research由来TODO」（追記のみ・採用判断はtools専権）
- **役割分担**: research＝「学長の考え方」、life-plan＝「自分の保有データ」

---

## §6. 自分の副業計画立案モード

「自分で着手する」と決めた副業の進捗追跡先：
- `research/MEMORY.md`「🎯 マイ副業ポートフォリオ」欄
- life-plan PWA に同期して老後シミュレーションに反映

### 採用済み自動化の「マイ副業ポートフォリオ」昇格ルール
自動化案件がtoolsで「採用」→ 実装完了 → 自分で運用開始する場合：
1. tools/MEMORY.md「🤖 research由来の自動化案件」の該当案件を「実装完了」マーク
2. research/MEMORY.md「🎯 マイ副業ポートフォリオ」に行追加
3. 月次売上・工数を継続記録

---

## §7. 編集権限の遵守（マルチセッション運用ルール準拠）

CLAUDE.md §マルチセッション運用ルールに従い、`research/` セッションは：
- **編集可能**: `research/` 配下のみ
- **追記のみ可能**（書き換え禁止）:
  - `blog/MEMORY.md` の「他セッションへのTODO」欄
  - `sns/calendar.md` の「💡 アイデアメモ」欄
  - `tools/MEMORY.md` の「🤖 research由来の自動化案件」セクション
  - `tools/{ec,cooking-recipe,life-plan}/MEMORY.md` の「🔬 research由来TODO」セクション
- **編集禁止**:
  - 他部門の SKILL.md
  - 記事本文（blog/articles/）
  - コード（scripts/, functions/）
  - 他部門のMEMORY.md内の他セクション

### 例外
- `handover/` への引き継ぎ書生成は通常通り可能

---

## §8. 送出上限（月10件）

- アイデア（synthesize由来）+ 自動化案件（automate由来）の **合計で月10件まで**
- 超過分は `research/MEMORY.md` 内で熟成
- 月初の棚卸し時にカウントリセット

### 理由
- 他部門が「research由来TODOが多すぎて本来作業ができない」状態を防ぐ
- 質より量にならないよう、研究部門側で熟成期間を設ける

---

## §9. tools側ステータス同期ルール

月初の research 棚卸し時：
- `tools/MEMORY.md`「🤖 research由来の自動化案件」の各案件ステータスを `research/MEMORY.md`「🤖 自動化提案台帳」へ反映
- 「採用」→ research側状態は「送出済（実装中）」と注記
- 「不採用」→ research側状態は「送出済（却下）」と注記、却下理由を備考に転記
- 「実装完了」→ research側 + マイ副業ポートフォリオ昇格判定

---

## §10. 振り返り（運用後追記）

| 日付 | 学び | 対応 |
|---|---|---|
| — | — | — |
