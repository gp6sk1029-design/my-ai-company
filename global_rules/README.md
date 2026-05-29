# global_rules - 社内AI開発ルールのGit管理

`~/.claude/CLAUDE.md` に配置される**全プロジェクト共通ルール**をこのフォルダで一元管理する。

## なぜこれが必要か

`~/.claude/CLAUDE.md` はClaude Codeの設定フォルダ配下にあり、Git管理されていない。
そのため複数PC（Mac・Windows職場PC等）で同じルールを維持するには手動コピーが必要だった。

このフォルダに配置することで：
- **Git管理される** → 変更履歴が残る
- **どのPCでも同じルール** → 職場PCとMacで挙動が一致
- **自動同期** → SessionStart時に自動で反映

## ファイル構成

| ファイル | 役割 |
|---|---|
| `CLAUDE_global.md` | マスター版（これを編集する） |
| `install.sh` | Mac/Linux用インストーラー |
| `install.bat` | Windows用インストーラー |

## 使い方

### 初回セットアップ
```bash
# Mac / Linux
bash global_rules/install.sh

# Windows（ダブルクリック または コマンドプロンプト）
global_rules\install.bat
```

### 差分確認のみ（変更しない）
```bash
bash global_rules/install.sh --check
```

### 自動同期（既に設定済み）
`.claude/settings.json` のSessionStartフックで、Claude Code起動時に
自動で `CLAUDE_global.md` → `~/.claude/CLAUDE.md` が同期される。

## 編集フロー

1. `global_rules/CLAUDE_global.md` を編集
2. `bash global_rules/install.sh` でローカルに反映
3. git commit → push（Stop hookで自動）
4. 他のPCでは次回Claude Code起動時に自動同期

## 安全対策

- 既存の `~/.claude/CLAUDE.md` は `.bak_YYYYMMDD_HHMMSS` でバックアップ
- 内容が完全一致なら何もしない（冪等）
- `--check` オプションで事前に差分確認可能
