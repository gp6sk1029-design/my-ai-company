/**
 * POST /api/search-recipes
 * 単発レシピ検索エンドポイント。Gemini 2.5 Flash にキーワードに合うレシピを3案生成させる。
 *
 * 入力（JSON）:
 *   query (string・必須)         検索キーワード（例: "カレー" "炒めもの" "鶏むね 簡単"）
 *   members[]                   家族メンバー（アレルギー・嫌い・好き・体調不良を反映）
 *   householdAllergies[]        全員アレルギー和集合
 *   avoidMode                   嫌い食材の扱い（any/majority/adjust）
 *   useCommercialSauces (bool)  市販調味料を許可するか
 *   maxCookTimeMin (number)     調理時間上限（任意・既定30）
 *
 * 出力（JSON）:
 *   { candidates: [meal x3] }
 */

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

// ------------ 出力スキーマ ------------
const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: '料理名（具体的に。例: 「鶏もも肉のチキンカレー」「豚肉と野菜の塩炒め」）' },
    category: { type: 'string', description: '主菜/副菜/汁物/主食/丼' },
    cuisine: { type: 'string', description: 'japanese/chinese/western/italian/korean/ethnic/donburi' },
    cookTimeMin: { type: 'integer' },
    servings: { type: 'integer' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          amount: { type: 'number' },
          unit: { type: 'string' },
          isCommercial: { type: 'boolean' },
        },
        required: ['name'],
      },
    },
    steps: { type: 'array', items: { type: 'string' } },
    cookwareHint: { type: 'string' },
    matchReason: { type: 'string', description: '検索キーワードとどう合致するかの一言（例: 「中辛のチキンカレー」） ' },
    healthAdjustNote: { type: 'string', description: '体調不良メンバー向けのアレンジ案（不要なら空文字）' },
  },
  required: ['name', 'cookTimeMin', 'ingredients', 'steps'],
};

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: MEAL_SCHEMA,
    },
  },
  required: ['candidates'],
};

// ------------ プロンプト構築 ------------
function buildPrompt(p) {
  const membersDesc = (p.members || []).map(m => {
    const kindLabel = m.kind === 'child' ? '子供' : '大人';
    const ageLabel = m.age ? `${m.age}歳` : '';
    const al = (m.allergies || []).join('、') || 'なし';
    const dl = (m.dislikes || []).join('、') || 'なし';
    const lk = (m.likes || []).join('、') || 'なし';
    const healthMark = m.healthIssue ? ' 🤒体調不良中' : '';
    return `- ${m.name}（${kindLabel}・${ageLabel}）アレルギー:[${al}] 嫌い:[${dl}] 好き:[${lk}]${healthMark}`;
  }).join('\n') || '- （メンバー情報なし）';

  const allergyUnion = (p.householdAllergies || []).join('、') || 'なし';

  const avoidText = {
    any: '誰か1人でも嫌いな食材は使用禁止',
    majority: '過半数が嫌いな食材は避ける',
    adjust: '嫌いな人には別メニューを提案して良い',
  }[p.avoidMode] || '誰か1人でも嫌いな食材は使用禁止';

  // 体調不良情報
  const sick = (p.members || []).filter(m => m.healthIssue && m.healthIssue.symptom);
  const SYMPTOM_LABEL = {
    cold: '風邪', stomach: '胃腸炎・胃もたれ', fever: '発熱', mouth: '口内炎・歯痛',
    summer: '夏バテ・食欲不振', hangover: '二日酔い', allergy: 'アレルギー悪化', other: 'その他',
  };
  const SYMPTOM_HINT = {
    cold: '温かく消化に良い・刺激物なし',
    stomach: '油控えめ・刺激物なし・柔らかい',
    fever: '消化早く水分多め',
    mouth: '噛まずに済む・刺激物なし',
    summer: 'さっぱり・酢や薬味で食欲増進',
    hangover: '優しい味・タンパク質補給',
    allergy: 'アレルゲン回避を強化',
    other: '本人メモを参照',
  };
  const healthBlock = sick.length === 0 ? '' :
`# 体調不良の家族（必ず配慮）
${sick.map(m => `- ${m.name}: ${SYMPTOM_LABEL[m.healthIssue.symptom] || 'その他'}（${SYMPTOM_HINT[m.healthIssue.symptom] || ''}）${m.healthIssue.note ? ' メモ:「'+m.healthIssue.note+'」' : ''}`).join('\n')}
→ 各候補の healthAdjustNote にこの方々向けのアレンジ案を必ず1〜2行書いてください（例:「たろうさん用は辛さなし＋豆腐追加で胃に優しく」）。
`;

  return `あなたは日本の家庭料理に詳しい料理研究家です。ユーザーが入力したキーワードに合うレシピを**3案**提案してください。

# 検索キーワード
「${p.query || ''}」

# 家族構成
${membersDesc}

# 【最優先】アレルギー食材（必ず完全除外）
${allergyUnion}

# 嫌い食材の扱い
${avoidText}

${healthBlock}

# 厳守ルール
- 3案は**バリエーションを持たせる**（例: キーワード「カレー」なら「ビーフカレー」「チキンカレー」「キーマカレー」のような切り口違い、またはジャンル違い）
- 各レシピの cookTimeMin は ${p.maxCookTimeMin || 30}分以内
- スーパーで普通に手に入る食材のみ使用（フレッシュハーブや輸入スパイスは禁止）
- ${p.useCommercialSauces ? '市販の合わせ調味料（Cook Do/うちのごはん等）の使用OK。使う場合は ingredients に製品名を明記し isCommercial=true' : '市販の合わせ調味料は使わず、基本調味料で味付けする'}
- アレルギー食材は完全除外（最優先）
- 嫌い食材は上記ルールに従う
- 工程は3〜6手順に収める
- 各案の matchReason に「キーワードのどこに合致するか」を一言書く
- 体調不良メンバーがいる場合は healthAdjustNote に「〇〇さん用は△△に変更」と具体策を必ず書く
- レシピ名は具体的に（「カレー」だけでなく「鶏もも肉のスパイシーチキンカレー」のように）

では、JSON で 3案 出力してください。candidates 配列の長さは必ず 3 にすること。`;
}

// ------------ ハンドラ ------------
export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response('GEMINI_API_KEY が設定されていません', { status: 500 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response('不正なJSON', { status: 400 });
  }

  const query = (payload.query || '').trim();
  if (!query) {
    return new Response(JSON.stringify({ error: 'query が空です' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const prompt = buildPrompt(payload);

  const geminiBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: OUTPUT_SCHEMA,
      temperature: 0.85,
      maxOutputTokens: 8192,
    },
  };

  // リトライ1回
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(GEMINI_ENDPOINT(apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      });
      if (!res.ok) {
        lastError = 'Gemini API ' + res.status + ': ' + (await res.text()).slice(0, 300);
        continue;
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) { lastError = 'Gemini レスポンスにテキストなし'; continue; }
      let parsed;
      try { parsed = JSON.parse(text); }
      catch (e) { lastError = 'JSON parse 失敗: ' + e.message; continue; }
      if (!parsed.candidates || !Array.isArray(parsed.candidates) || parsed.candidates.length === 0) {
        lastError = 'candidates 配列なし';
        continue;
      }
      return new Response(JSON.stringify(parsed), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      lastError = String(e);
    }
  }
  return new Response('検索失敗: ' + lastError, { status: 502 });
}
