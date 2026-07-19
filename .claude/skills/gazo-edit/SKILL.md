---
name: gazo-edit
description: 画像編集スキル。ChatGPT/Geminiで生成した画像をすぐCanvaで手動編集できるよう、ブラウザを左右2分割（左＝AI画像生成・右＝Canvaの1200×630空キャンバス）で開く。Canva側はAPIで「枠デザイン」を複製して編集URLを直接開くので、ホームで迷子にならず「貼るだけ」の状態から始まる。ユーザーが「画像編集」「画像仕上げ」「canva編集」「2分割で画像作る」と入力したら起動する。
---

# 画像編集スキル（AI生成 × Canva 2分割ワークフロー）

「①左でAI画像生成 → ②右のCanvaに⌘Vで貼る → ③手動で仕上げ」を1コマンドで準備する。
記事めしとは独立して使える（記事めし由来のプロンプトを渡してもOK）。

## 固定データ（変更時はここを書き換える）

| 項目 | 値 |
|---|---|
| 枠デザインID（1200×630・空） | `DAHPxq8x0v8` |
| 枠の名前 | 【枠】画像仕上げ 1200×630（画像編集スキル用・削除しない） |
| 作成日 | 2026-07-19（Canva Connect APIで copy→resize→空化で作成） |

> 🚨 枠が消えた/壊れた場合の再作成：任意の既存デザインを `copy-design` → `resize-design`(custom 1200×630) → 編集トランザクションで全要素 `delete_element` ＋ `update_title` → commit。新IDをこの表に反映する。

## 引数の解釈

- `/画像編集` だけ → 左＝ChatGPT（空）、右＝Canva新キャンバス
- `/画像編集 <プロンプト>` → 左＝ChatGPTにプロンプトを自動入力して開く
- 「Geminiで」を含む → 左＝Gemini（URL自動入力は不可のため、プロンプトはクリップボードにコピーして渡す）
- 記事めしの画像生成プロンプトをそのまま渡してもよい

## 実行手順（Claudeが行うこと）

### Step 1: Canvaの作業キャンバスを用意（API）
1. Canva MCPツールがdeferredなら ToolSearch で一括ロード：`copy-design`（＋名前変更する場合は `start-editing-transaction`,`perform-editing-operations`,`commit-editing-transaction`）
2. `copy-design`（design_id=枠ID）→ レスポンスの `edit_url` を得る
3. **名前変更（必須）**：複製は枠と同名になり紛らわしいため、編集トランザクションで `update_title`「画像仕上げ YYYY-MM-DD HHMM（テーマ名）」に変更して commit（今作った複製のみが対象なので確認不要）
4. ⚠️ Canva MCPが未接続/認証切れの場合：中断せず「右＝ https://www.canva.com/ 」のフォールバックで開き、その旨をユーザーに伝える

### Step 2【最優先】: Chromeの分割ビューを再利用し、中身のURLだけ差し替える（2026-07-20確立）
🥇 **これが第一選択。** Chromeのタブ分割ビュー（1ウィンドウ内で左右2分割）は、macOSのSpaces操作が一切不要で、
ウィンドウが別スペースに行方不明になる事故も構造的に起きない。
🚨 **分割ビューを「作る」操作は自動化できない**（Chrome 150のAppleScript辞書に split/tile 機能なし＝2026-07-19実測）。
そこで **ユーザーが一度作った分割ビューのウィンドウを使い回し、中身のURLだけ入れ替える**。

```bash
osascript <<'EOF'
tell application "Google Chrome"
  set targetWin to missing value
  repeat with win in windows
    set hasCanva to false
    set hasAI to false
    repeat with t in tabs of win
      if (URL of t) contains "canva.com/design" then set hasCanva to true
      if ((URL of t) contains "chatgpt.com") or ((URL of t) contains "gemini.google.com") then set hasAI to true
    end repeat
    if hasCanva and hasAI then
      set targetWin to win
      exit repeat
    end if
  end repeat
  if targetWin is missing value then return "NO_SPLIT_WINDOW"
  repeat with t in tabs of targetWin
    if (URL of t) contains "canva.com/design" then set URL of t to "<CANVA_EDIT_URL>"
    if (URL of t) contains "chatgpt.com" then set URL of t to "<AI_URL>"
  end repeat
  activate
  return "OK"
end tell
EOF
```
- `NO_SPLIT_WINDOW` が返った時だけ下の Step 2-fallback へ。
- 🛡 **ユーザーがChatGPTに入力中のテキストがあるとページ遷移で消える**。差し替え前に一言確認するか、AI側タブは触らず Canva 側だけ差し替える。

### Step 2-fallback: 分割ビューが無い場合（1ウィンドウ2タブを用意して手動で分割してもらう）
1ウィンドウに ChatGPT と Canva の2タブを作って前面に出し、ユーザーに
**「どちらかのタブを右クリック →『新しい分割ビューにタブを追加』」** を案内する（右クリック1回だけ）。
```bash
osascript <<'EOF'
tell application "Google Chrome"
  make new window
  set w to front window
  set URL of active tab of w to "<AI_URL>"
  make new tab at end of tabs of w with properties {URL:"<CANVA_EDIT_URL>"}
  set bounds of w to {0, 0, 2560, 1440}
  activate
end tell
EOF
```

### Step 2-old（非推奨）: 2つのウィンドウを左右に並べる（osascript）
> ⚠️ 旧方式。ウィンドウが別スペースへ飛んで見失う事故が実際に多発した（2026-07-19）。分割ビューが使えるなら使わない。
既存のCanvaウィンドウ/AIウィンドウがあれば再利用し、ウィンドウを増やさない：

> 🚨 AppleScriptは**大文字小文字を区別しない**。画面幅を `W`、ループ変数を `w` にすると衝突して
> 「item 3 of every window をrectangleに変換できません」エラーになる（2026-07-19実測）。
> 必ず `scrW/scrH/win` のような非衝突名を使うこと。

```bash
osascript <<'EOF'
tell application "Google Chrome"
  tell application "Finder" to set db to bounds of window of desktop
  set scrW to item 3 of db
  set scrH to item 4 of db
  set halfW to scrW div 2
  -- 右：Canva（既存canvaウィンドウを再利用、なければ新規）
  set foundC to false
  repeat with win in windows
    try
      if URL of active tab of win contains "canva.com" then
        set URL of active tab of win to "<CANVA_EDIT_URL>"
        set bounds of win to {halfW, 0, scrW, scrH}
        set foundC to true
        exit repeat
      end if
    end try
  end repeat
  if not foundC then
    make new window
    set URL of active tab of front window to "<CANVA_EDIT_URL>"
    set bounds of front window to {halfW, 0, scrW, scrH}
  end if
  -- 左：AI画像生成（既存chatgpt/geminiウィンドウを再利用、なければ新規）
  set foundA to false
  repeat with win in windows
    try
      if (URL of active tab of win contains "chatgpt.com") or (URL of active tab of win contains "gemini.google.com") then
        set URL of active tab of win to "<AI_URL>"
        set bounds of win to {0, 0, halfW, scrH}
        set foundA to true
        exit repeat
      end if
    end try
  end repeat
  if not foundA then
    make new window
    set URL of active tab of front window to "<AI_URL>"
    set bounds of front window to {0, 0, halfW, scrH}
  end if
  activate
end tell
EOF
```

- `<AI_URL>`：ChatGPT＝プロンプトありなら `https://chatgpt.com/?q=<URLエンコード>`（エンコード後5000バイト以内・記事めし実測上限）、なしなら `https://chatgpt.com/`。Gemini＝`https://gemini.google.com/app`（プロンプトは `pbcopy` でクリップボードへ）
- プロンプトを渡された場合は、URL入力と別に**全文を `pbcopy`** もしておく（長文切れ対策）

### Step 3: ユーザーへの案内（毎回この3行を出す）
```
🖼 左でAI画像を生成 → 画像を右クリック「画像をコピー」
🎨 右のCanvaをクリック → ⌘V で貼付 → 手動で編集
📤 仕上がったら「書き出して」と言えば私がPNGで書き出します（またはCanvaの共有→ダウンロード）
```

### Step 4（オプション）: 書き出し代行
ユーザーが「書き出して」と言ったら：`get-export-formats` → `export-design`（png・1200×630）→ ダウンロードURLを提示。

### Step 5: 記事めしへ取り込む（「記事めしに入れて」「取り込んで」）
Canvaで仕上げた画像を、記事めしの記事フォルダへ**役割つきファイル名**で保存する。
1. `get-export-formats` → `export-design`（type=png / width=1200 / height=630）でダウンロードURLを得る
2. そのURLを `canva_to_meshi.py` に渡す（**画像バイナリは会話に通さない**＝コンテキスト肥大を防ぐ）:
```bash
python3 blog/scripts/canva_to_meshi.py \
  --url "<export-designで得たURL>" \
  --folder-id "<記事めしの記事フォルダID>" \
  --role eyecatch    # eyecatch/hero/section/product/diagram/compare/comparetable/ngsummary
```
3. 記事フォルダIDが不明なら Drive MCP の `search_files`（`title contains '【記事】<記事名>'`）で特定する
- 仕組み：記事めしGASの `uploadSmall`（20MB上限・`articleFolderId`指定可）へPOST。ファイル名prefixがそのまま役割になる
- 疎通確認だけしたい時：`python3 blog/scripts/canva_to_meshi.py --ping`
- **同じ画像を再取り込みすると「重複スキップ」**（GASがハッシュ判定）。仕上げを変えたら再書き出しするか `--name` で別名指定
- 取り込み後は記事めし/`article_from_meshi.py` から通常の記事画像として使える

### 専用デスクトップにしたい場合
**Chromeの分割ビュー（Step 2）を使っていれば、対象は1ウィンドウだけ**なので話は簡単：
そのウィンドウの**緑（○）ボタンをクリックして全画面にするだけ**で、macOSが自動的に専用スペースを割り当てる。
🚨 このクリックもClaudeは代行できない（ブラウザはtier=read＝閲覧のみ／macOSにSpaces操作APIなし／teachモードも本セッションでは利用不可・2026-07-19実測）。**ユーザーに1クリックを依頼し、`mcp__computer-use__screenshot` で結果を目視確認する**（見るのは可・触るのは不可）。
> 旧メモ：ウィンドウ2枚をmacOS Split Viewで合体させる方法は手数が多く事故りやすい。分割ビュー方式に統一したので使わない。

## トラブルシューティング
- **osascriptが突然 `-1743`（Apple Events権限なし）で全滅**：Claude Codeがセッション中に自動アップデートされ旧バイナリが消えた可能性大（実行中バージョンのフォルダが `ls` で存在しないなら確定）。→ **Claudeアプリを再起動**（会話は履歴から再開可）。設定いじり・`tccutil reset` では直らない（2026-07-19実測）

## 禁止・注意
- 枠デザイン（DAHPxq8x0v8）自体を編集・削除しない（毎回**複製**を使う）
- Canvaのユーザー既存デザインを勝手に編集しない（このスキルで触ってよいのは自分が複製したキャンバスのみ）
- `?create&width=...` 等のCanva URLパラメータは**効かない**（ホームに飛ぶ・2026-07-19実測）。必ずAPI複製方式を使う
- 完成画像をブログに使う際は従来通り `image_resizer.py`（1800px以下）を通す

## 自己改善ループ（CLAUDE.mdに準拠）
このスキルはCLAUDE.mdの方針に従い、実行のたびに気づきを blog/MEMORY.md に追記し、
手順が変わったらこのSKILL.mdを更新する。ROI評価を毎回行う。
