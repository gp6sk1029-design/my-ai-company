# メール秘書 引き継ぎ書
> 最終更新: 2026-05-06  
> 担当者：幸田 祥平（sy-kouda@ime-group.co.jp）  
> GitHub branch: `claude/priceless-liskov`

---

## 1. システム概要

「メール秘書」は **Thunderbird（POP3）の受信メールに自動・手動で返信下書きを生成** するデスクトップアプリ。  
Gemini 2.5 Flash APIを使って返信文を生成し、Thunderbirdの Drafts mbox に直接書き込む。

### 起動方法
```
work/companies/一宮電機/email/メール秘書.vbs をダブルクリック
```
（`.vbs` → `.bat` → `python メール秘書.pyw` と順に呼び出す。コンソールウィンドウを隠すため `.pyw` で起動）

---

## 2. ファイル構成

| ファイル | 役割 |
|---|---|
| `メール秘書.pyw` | GUIアプリ本体（tkinter）4タブ構成 |
| `auto_draft.py` | メール処理・Gemini API・mbox読み書きのロジック集 |
| `.env` | `GEMINI_API_KEY` / `MY_EMAIL` / `MY_NAME` を格納 |
| `keywords.json` | スパム判定キーワード・除外送信者・自動学習リスト |
| `style_profile.json` | 返信文の文体設定（口調・表現集） |
| `last_processed.json` | 処理済みメールIDのキャッシュ（重複下書き防止） |
| `logs/YYYY-MM.log` | 自動下書きのログファイル |
| `メール秘書.bat` / `メール秘書.vbs` | 起動スクリプト |

---

## 3. アプリUIタブ構成

| タブ | 機能 |
|---|---|
| ① 🤖 自動下書き | ON/OFFトグル・ログ表示。30分ごとに新着チェック→下書き自動生成 |
| ② 🔑 キーワード管理 | スパム除外キーワード / 除外送信者 / 自動学習済みを管理 |
| ③ ✏️ 文体設定 | 口調・よく使う表現・避けたい表現・癖 を設定 |
| ④ 📝 手動下書き | フォルダ選択→メール一覧→1件選択→下書き作成 |

---

## 4. 主要設定値（auto_draft.py）

```python
RECENT_MINUTES   = 35      # 受信から35分以内のメールのみ自動下書き対象
LOOP_INTERVAL    = 1800    # 30分ごとにチェック
LARGE_FILE_THRESHOLD = 50MB  # これ超えたら末尾読みモード
TAIL_SCAN_BYTES  = 5MB     # 末尾読みのサイズ
STYLE_SAMPLE_MAX = 5       # 送信済みメールから文体学習する件数
```

### 監視フォルダ（INBOX_PATHS）
```
Inbox                           （受信トレイ）
Inbox.sbd/1_社内.sbd/他部署.sbd/2_社外
Inbox.sbd/1_社内.sbd/他部署.sbd/3_海外
Inbox.sbd/1_社内.sbd/生産技術部    ← 5.1GB 大容量→末尾読み
```

### Thunderbirdプロファイルパス
```
C:\Users\SEIGI-N13\AppData\Roaming\Thunderbird\Profiles\ia5jx4ac.default-release\Mail\mail.ime-group.co.jp\
```

---

## 5. 処理フロー

### 自動下書き（30分ごと）
```
auto_draft.py 起動
  └─ Thunderbird起動確認
  └─ check_once() → 全INBOX_PATHSをスキャン
       └─ _iter_inbox()  ※50MB超は_iter_tail_messages()使用
       └─ is_recent() で35分以内のみ対象
       └─ needs_reply() でスパム/除外を除外
       └─ generate_reply() → Gemini API呼び出し
       └─ write_draft() → Drafts mboxに追記
  └─ 1件以上作成 → _restart_thunderbird()（まとめて1回のみ）
  └─ 1800秒待機 → 繰り返し
```

### 手動下書き（ユーザー操作）
```
タブ④を開く
  └─ フォルダ選択 → 「📥 一覧を取得」
       └─ _iter_inbox() でメール取得
       └─ Message-ID重複除去 + 日付降順ソート → 最新30件表示
  └─ 1件選択 → 「📝 この件を下書き作成」
       └─ get_thread_simple() で過去スレッド取得
       └─ generate_reply() → Gemini API
       └─ write_draft() → Drafts mboxに追記
       └─ _restart_thunderbird()
```

---

## 6. 重要な技術ポイント・過去の教訓

### mboxファイル操作
- **Thunderbird POP3形式の罠**：`>From` エスケープが崩れた場合、ヘッダーが本文扱いになる → `get_effective_msg()` で再パース
- **X-Mozilla-Status: 0000** を使う（0008はExpungedフラグで削除扱いになる）
- **X-Mozilla-Draft-Info ヘッダー必須**（これがないとThunderbirdが下書きと認識しない）
- **Thunderbird起動中はmboxを書き込まない**（WinError 32ファイルロック）
  → `_restart_thunderbird()` で一旦終了してから書き込み、再起動

### 大容量mbox（生産技術部 5.1GB）
- `_iter_tail_messages()` で末尾5MBだけ読む高速モード
- From行の分割は**曜日パターン**で厳格判定（本文中の `From ` で誤分割を防ぐ）
  ```python
  FROM_LINE = rb'\nFrom \S+ (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) '
  ```

### 孤児プロセス問題
- メール秘書.pywを×ボタンで閉じると auto_draft.py が生き残る問題
- **Windows Job Object** (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) で解決済み
- 起動時に `_kill_orphan_auto_draft()` で前回の孤児を掃除

### 手動下書きの多重実行防止
- `_manual_creating` フラグ ＋ ボタン `state="disabled"` の二重ガード
- 生成完了/エラー時に自動復帰

---

## 7. 現在の文体設定（style_profile.json）

```json
{
  "口調": "丁寧なビジネス敬語・簡潔明瞭",
  "よく使う表現": ["承知いたしました。", "引き続きよろしくお願いいたします。", ...],
  "避けたい表現": ["了解です", "確認しました", "了解しました"],
  "その他の癖・好み": ["結論を先に書く", "箇条書きを積極的に使う", "長文にならないよう簡潔にまとめる"]
}
```

---

## 8. 既知の課題・改善候補

| 優先度 | 内容 | 難易度 |
|---|---|---|
| 中 | 手動下書きで生成した返信文をプレビュー・編集してから保存 | 中 |
| 中 | 手動下書きでフォルダをまたいでスレッド履歴を検索 | 中 |
| 低 | 自動下書きの対象フォルダをUI上で追加・削除できるように | 中 |
| 低 | 手動下書き一覧の件数を30件→任意変更できるように | 低 |

---

## 9. 次セッションで作業を始めるときの確認手順

```
1. git pull（最新を取得）
2. メール秘書.vbs を起動して動作確認
3. タブ④「手動下書き」で「一覧を取得」→Thunderbirdの表示と一致するか確認
4. 必要なら logs/ を見て直近の自動下書きの動作状況を把握
```

---

## 10. 環境・依存関係

```
Python 3.13
google-genai （Gemini API）
python-dotenv
mailbox（標準ライブラリ）
tkinter（標準ライブラリ）
```

インストール:
```
pip install -r requirements.txt
```

`.env` ファイル（リポジトリ外・絶対コミット禁止）:
```
GEMINI_API_KEY=xxxxxx
MY_EMAIL=sy-kouda@ime-group.co.jp
MY_NAME=幸田
```
