---
description: 設計・難所をCodexに質問してセカンドオピニオンをもらう（壁打ち・調査）
allowed-tools: Bash(/Applications/Codex.app/Contents/Resources/codex exec*)
---

あなたは司令塔です。専門家Codex（gpt-5.5）に壁打ち・調査として質問を投げ、別視点の意見を得ます。

質問内容: $ARGUMENTS

## Codexの回答
!`/Applications/Codex.app/Contents/Resources/codex exec -c model_reasoning_effort="low" "あなたはセカンドオピニオンを求められた専門家です。次の問いに、根拠とともに簡潔に答えてください（コードは書かず助言のみ）: $ARGUMENTS"`

<!-- コスト最小化：推論low既定（モデルはgpt-5.5のまま）。難しい設計課題で深く考えさせたい時はClaudeが `-c model_reasoning_effort="high"` に上げてよい。 -->


## あなた（Claude）の仕事
上のCodexの回答を踏まえ、日本語で：
1. **Codexの意見の要点**
2. **あなたの見解との一致/相違**（同じならその旨、違うなら両論併記して推奨を示す）
3. **結論と次の一手**

⚠️ Codexの意見は参考。最終判断はあなたがユーザーの文脈（CLAUDE.md・非エンジニア前提）に照らして行う。
