# 引継ぎ書：生産技術主任補佐PDM

> 作成日: 2026-06-25
> セッション: FP7 Diff 新規開発 ＋ PLC Craft AI 翻訳機能追加 ＋ ローカルWebツール常駐化の恒久対策 ＋ Git同期復旧
> ステータス: ✅ 全タスク完了・Git同期復旧済み

---

## 🔑 復帰用プロンプト（新セッション冒頭にコピー＆ペースト）

```
あなたは「生産技術主任補佐PDM」として動きます。
幸田主任（株式会社一宮電機 生産技術部 主任）の左腕として、本業ツール群と副業部門を統括する役割です。

セッション再開のため、以下を読み込んでください（順番に）:
1. C:\Users\SEIGI-N13\.claude\CLAUDE.md（全社ルール）
2. C:\Users\SEIGI-N13\work-projects\CLAUDE.md（本業全体ルール・「ツール・アプリ開発の標準パターン」が重要）
3. C:\Users\SEIGI-N13\my-ai-company\.claude\worktrees\sharp-nash-97b8d9\CLAUDE.md（副業worktree）
4. C:\Users\SEIGI-N13\.claude\projects\C--Users-SEIGI-N13-my-ai-company\memory\MEMORY.md（自動メモリindex）
5. C:\Users\SEIGI-N13\work-projects\MEMORY.md（特に末尾「ローカルWebツールの常駐起動恒久対策」セクション）
6. この引き継ぎ書: C:\Users\SEIGI-N13\my-ai-company\handover\2026-06-25-生産技術主任補佐PDM-FP7Diff新規開発＋PLCツール常駐化恒久対策.md

読み終わったら、まず以下を確認:
- PLC Craft AI（http://localhost:3001）と FP7 Diff（http://localhost:3002）の稼働状況
- 主任の今日のメインタスク
```

---

## 📋 本セッションの主成果（4本柱）

### A. FP7 Diff 新規ツール開発（Panasonic FP7 PLCプログラム比較）

**配置**: `C:\Users\SEIGI-N13\work-projects\fp7-diff\`
**本番URL**: http://localhost:3002（Express単体・port 3002）

| 機能 | 状態 | 備考 |
|---|---|---|
| 変数・コメント比較（グローバルデバイス.txt UTF-16LE） | ✅ 完成 | 1号機 vs 2号機で実データ検証済み |
| 4種差分計算（変更/追加/削除/同一） | ✅ 完成 | 変更37/追加34/削除8/同一1174 |
| AI解説サマリ（Gemini 2.5 Flash） | ✅ 完成 | 横展開・標準化・改造履歴の3観点 |
| PDFラダー図 視覚比較 | ✅ 完成 | PyMuPDF 220dpi + pHash対応付け + OpenCVピクセル差分赤枠 |
| UI改良 | ✅ 完成 | ズーム3段階／同期スクロール／全画面拡大／JSマウスリサイズ／タブ状態保持 |
| ラング単位比較（Sysmac Studio相当） | 🔒 **保留**（D選択） | プロト `server/python/detect_rungs.py` 残置・再開条件あり |

**確定した重要技術知見**:
- `.fpx` バイナリは独自圧縮/暗号化で**直接読込み不可能**（5,591件のASCII検出も全部ノイズ、確証付き）→ FPWIN GR7 のエクスポートが唯一の解
- グローバルデバイス.txt は **UTF-16 LE BOM付き・タブ区切り**: `アドレス\tコメント\t\t`
- デバイスカテゴリ判定は**長い接頭辞から判定**（DT/LD/SD/SR を X/Y/R/L より先に判定しないと誤検出）
- PDFラダーは画像埋め込み → 220dpi PNG化 + pHash対応付け + OpenCVピクセル差分

### B. PLC Craft AI 設備翻訳機能追加（plc-debugger）

**配置**: `C:\Users\SEIGI-N13\work-projects\plc-debugger\`
**本番URL**: http://localhost:3001

| 追加機能 | 内容 |
|---|---|
| 🌐 設備翻訳タブ | 日⇄英・生産設備特化 |
| 3モード | ①文章 ②PLC変数名候補（IEC/ハンガリアン/シンプル） ③略語逆引き |
| 略語提案 | 国際標準＋IEC 61131-3命名規則、根拠付き |
| 社内用語辞書（SQLite） | hit_count順で蓄積・AIプロンプトに自動注入 |
| 共通 jsonRepair.ts（3段階リトライ） | 全Geminiメソッドに統一適用 |
| プログラム解析バグ根治 | JSONパース失敗時の堅牢化 |

### C. ローカルWebツール常駐化の恒久対策（最重要・両ツール共通）

**問題**: 開発サーバ（vite）は起動セッションが終わると一緒に落ちる → 「いちいち止まる」現象

**根本対策**（両ツール共通パターン確立）:
1. **client を `vite build`** → `client/dist` に静的化
2. **Express を `NODE_ENV=production`** で起動 → `client/dist` を静的配信（vite開発サーバ不要）
3. **ポートを分離**: PLC Craft AI=3001 / FP7 Diff=3002
4. **start-production.bat**: production起動（`timeout` は非対話で失敗するため `ping -n 2 127.0.0.1 >nul` に置換）
5. **start-hidden.vbs**: batをウィンドウ非表示で起動
6. **スタートアップフォルダにVBSショートカット**配置（管理者権限不要・タスクスケジューラは権限エラーで使えない）
7. **デスクトップ「スマート起動」**: `open-*.bat`（ヘルスチェック→生きてれば開くだけ／死んでればVBS起動）

**現状の自動起動設定（2026-06-25時点）**:
- ❌ **PLC Craft AI 自動起動: 解除**（主任指示） → デスクトップアイコン手動起動
- ✅ **FP7 Diff 自動起動: 有効** → `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\FP7 Diff (Auto).lnk`

### D. Git同期復旧（push失敗の根本対処）

**症状**: SessionStart で「前回のpushが rejected」警告
**真因**: ローカル ahead 1, behind 152（2026-06-02 から約3週間 git pull が走っていなかった）+ リモートに **Windowsで使えない半角コロン `:` を含むファイル**が1個あった

**対処手順**（実施済み）:
1. GitHub Web UI で問題ファイル `handover/2026-05-31-0543-ブログPWA: ...md` をリネーム（`:` → `-`）
2. `git fetch origin main` → `git pull --rebase origin main` で 153コミット取り込み
3. `git push origin main` → コミット `f18489d` で完全同期

**現状**: `## main...origin/main`（完全一致・ahead/behind なし）

---

## 🔍 現在の状態（再開時に確認すべきこと）

### サーバ稼働状況
```powershell
Get-NetTCPConnection -LocalPort 3001,3002 -State Listen | Select-Object LocalPort, OwningProcess
```
- 期待: 3001（PLC Craft AI）と 3002（FP7 Diff）でリッスン中
- FP7 Diff は自動起動有効→ログオン後10〜30秒で立ち上がる
- PLC Craft AI は自動起動解除→デスクトップ「PLC Craft AI」アイコンで手動起動

### 未コミットファイル（次セッションで commit/push 対象）
- **副業（my-ai-company worktree `sharp-nash-97b8d9`）**: 本引き継ぎ書 `handover/2026-06-25-...md`
- **本業（work-projects）**: FP7 Diff 新規一式・PLC Craft AI 改修一式・start-production.bat群・VBSランチャー群・本番版 client/dist 等
- ※ work-projects のgit運用状況は未確認（次セッションで status 確認推奨）

### Git状態（副業 my-ai-company）
- ✅ ローカル＝リモート完全同期（`f18489d`）

---

## 📌 未完了・保留事項

| # | 項目 | 状態 | 再開条件 |
|---|---|---|---|
| 1 | FP7 Diff のラング単位比較（Sysmac Studio相当UX） | 🔒 保留 | 主任要望時／差分ページが多すぎて目視が辛い時 |
| 2 | FP7 Diff のPDF Vision統合（差分ページのAI解説） | 🔒 次フェーズ | `server/src/services/pdfAnalyzer.ts` がプレースホルダ |
| 3 | 注文書 BOM取込ツール `build_from_bom.py` | 🔒 保留 | BOMサンプル待ち |
| 4 | drawing-checker 残タスク3件 | ⚠️ 未完了 | `.env` 作成／PDFプレビュー検証／AI検図テスト |
| 5 | 巻線軌跡検証Excel（Sysmac Studio実データでの倍率検証） | ⚠️ 検証待ち | θ×10・Z×100 |
| 6 | FP7 Diff 自動起動の実機検証 | ⚠️ 未確認 | 次回ログオン時に主任に動作確認依頼（boot.log を見ればエラー特定可能） |
| 7 | work-projects のコミット | ⚠️ 多数未コミット | 次セッションで status 確認＋commit |

---

## 🗂️ 管理対象ツール一覧

### 本業（work-projects）
| # | ツール名 | 用途 | 状態 |
|---|---|---|---|
| 1 | **email-assistant**（メール秘書） | Thunderbird自動下書き・Gemini 2.5 Flash | ✅ 稼働中 |
| 2 | **plc-debugger**（PLC Craft AI） | オムロン Sysmac Studio 解析・🌐設備翻訳（新） | ✅ 本番モード化済み・port 3001 |
| 3 | **media-transcriber** | 動画/音声 文字起こし＋要約 | ✅ 稼働中 |
| 4 | **drawing-checker** | SolidWorks 2D図面 検図 | ⚠️ 残タスクあり |
| 5 | **winding-report** | 巻線軌跡検証Excel | ⚠️ 実機検証待ち |
| 6 | **farewell-docs** | 送別会会費管理 | ✅ 完了 |
| 7 | **order-template** | 注文書テンプレ | ⚠️ BOM取込保留 |
| 8 | **fp7-diff** (NEW) | Panasonic FP7 比較 | ✅ 本番モード稼働中・port 3002 |

### 副業（my-ai-company）
- ブログ部門（生産技術ガジェット研究所）
- SNS部門（X／Instagram／YouTube）
- ツール作成部門（メルカリ自動化／献立くん／ライフプランくん）

---

## 🎓 セッション運用ルールの再掲

- 自称は「補佐PDM」、主任への呼びかけは「幸田主任」
- 結論先行・数値化・再現性
- 振り返りレポート（CLAUDE.mdフォーマット）はタスク完了時に出力
- 大物タスクは専用セッション提案
- AI操作の判断フロー：
  1. 人間がブラウザで見ながらやる作業？ → Claude in Chrome
  2. 裏で勝手に動かす処理？ → API
  3. エンドユーザー向け機能？ → API（PWA組込み）

---

## 📁 主要ファイル索引

### FP7 Diff
```
C:\Users\SEIGI-N13\work-projects\fp7-diff\
├ package.json
├ start-production.bat        (NODE_ENV=production で Express起動)
├ start-hidden.vbs            (非表示起動)
├ open-fp7-diff.bat           (デスクトップアイコン用スマート起動)
├ server/
│ ├ .env                      (GEMINI_API_KEY)
│ ├ src/
│ │ ├ index.ts                (Express + 本番静的配信)
│ │ ├ db/sqlite.ts            (sql.js 履歴DB)
│ │ ├ services/
│ │ │ ├ globalDeviceParser.ts (UTF-16LE タブ区切りパーサ)
│ │ │ ├ diffCalculator.ts     (4状態分類)
│ │ │ ├ aiSummarizer.ts       (Gemini 解説)
│ │ │ ├ pdfDiffRunner.ts      (Python サブプロセス)
│ │ │ └ jsonRepair.ts         (3段階リトライ)
│ │ └ routes/
│ │   ├ compare.ts            (/api/compare)
│ │   └ pdfDiff.ts            (/api/pdf-diff + 画像配信)
│ └ python/
│   ├ pdf_diff.py             (220dpi PNG化 + pHash + OpenCV差分)
│   └ detect_rungs.py         (ラング検出プロト・保留)
└ client/
  ├ dist/                     (vite build 成果物・本番配信元)
  └ src/
    ├ App.tsx                 (タブ切替・display:none で状態保持)
    └ components/
      ├ PdfDiffViewer.tsx     (左右並列＋赤枠＋ズーム＋同期スクロール＋JSリサイズ)
      ├ DiffViewer.tsx        (4状態テーブル＋CSV出力)
      └ AiAnalysisPanel.tsx   (AI解説5パネル)
```

### PLC Craft AI
```
C:\Users\SEIGI-N13\work-projects\plc-debugger\
├ start-production.bat
├ start-hidden.vbs
├ open-plc.bat                (デスクトップアイコン用)
└ server/
  └ src/
    ├ services/
    │ ├ translationService.ts (🌐設備翻訳・Gemini)
    │ ├ jsonRepair.ts         (共通3段階リトライ)
    │ └ claudeService.ts      (全AIメソッドが jsonRepair 経由に統一)
    ├ db/glossaryDb.ts        (社内用語辞書 SQLite)
    └ routes/translate.ts     (/api/translate)
```

### 共通インフラ
```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\
└ FP7 Diff (Auto).lnk         (ログオン時自動起動・wscript経由)

デスクトップ
├ PLC Craft AI.lnk            (open-plc.bat を指す)
└ FP7 Diff.lnk                (open-fp7-diff.bat を指す)
```

---

## ✅ 次セッションで最初に確認すべきこと（チェックリスト）

- [ ] PLC Craft AI と FP7 Diff のサーバが両方生きているか（ポート3001/3002）
- [ ] FP7 Diff の自動起動が次回ログオン時に効いているか主任に確認
- [ ] work-projects 側の git status 確認＆未コミット変更の commit/push
- [ ] my-ai-company 側の本引き継ぎ書をコミット
- [ ] 主任の今日のメインタスクは何か

---

## 💰 本セッションのROI（参考）

| ツール | 月削減効果 | 開発工数 | 回収期間 |
|---|---|---|---|
| FP7 Diff（変数比較） | 月3時間 ≒ 9,000円 | 4h | 約4週間 |
| FP7 Diff（PDF視覚比較） | 月1.5時間 ≒ 4,500円 | 4h | 約3ヶ月 |
| PLC Craft AI 設備翻訳 | 月8.3時間 ≒ 25,000円 | 2h | 約3営業日 |
| 常駐化恒久対策 | ストレス排除（定量化困難） | 3h | — |
| **合計** | **月38,500円相当** | **13h** | **平均約2ヶ月** |

---

*以上。新セッションでもこの引き継ぎ書を最初に読めば、即座に作業再開できます。*
