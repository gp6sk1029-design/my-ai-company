/**
 * POST /api/generate
 * 献立生成エンドポイント。Gemini 2.5 Flash に構造化出力で献立を生成させる。
 *
 * 入力（JSON）:
 *   month, members[], householdAllergies[], avoidMode,
 *   budgetYen, maxCookTimeMin, moodTag, seasonalHint[],
 *   days, mealTypes[], basicIngredientsOnly, batchShopping,
 *   favorites[], recentlyCooked[], blocked[], stockIngredients[], stockPriority
 *
 * 出力（JSON）:
 *   { days: [{dayIndex, meals: {breakfast?, lunch?, dinner?}}], totalBudgetYen, notes }
 */

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

// ------------ 出力スキーマ（構造化出力強制） ------------
const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    category: { type: 'string', description: '主菜/副菜/汁物/主食' },
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
          shelfLifeDays: { type: 'integer' },
          storage: { type: 'string', description: '常温/冷蔵/冷凍可' },
        },
        required: ['name'],
      },
    },
    steps: { type: 'array', items: { type: 'string' } },
    seasonalReason: { type: 'string' },
    useLeftover: { type: 'boolean' },
    cookwareHint: { type: 'string' },
    isFavorite: { type: 'boolean' },
    favoriteReason: { type: 'string' },
  },
  required: ['name', 'cookTimeMin', 'ingredients', 'steps'],
};

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dayIndex: { type: 'integer' },
          meals: {
            type: 'object',
            properties: {
              breakfast: MEAL_SCHEMA,
              lunch: MEAL_SCHEMA,
              dinner: MEAL_SCHEMA,
            },
          },
        },
        required: ['dayIndex', 'meals'],
      },
    },
    totalBudgetYen: { type: 'integer' },
    notes: { type: 'string' },
  },
  required: ['days'],
};

// ------------ プロンプト構築 ------------
function buildPrompt(p) {
  const mealLabel = { breakfast: '朝食', lunch: '昼食', dinner: '夕食' };
  const mealList = (p.mealTypes || ['dinner']).map(m => mealLabel[m] || m).join('・');

  const membersDesc = (p.members || []).map(m => {
    const kindLabel = m.kind === 'child' ? '子供' : '大人';
    const ageLabel = m.age ? `${m.age}歳` : '';
    const al = (m.allergies || []).join('、') || 'なし';
    const dl = (m.dislikes || []).join('、') || 'なし';
    const lk = (m.likes || []).join('、') || 'なし';
    return `- ${m.name}（${kindLabel}・${ageLabel}）アレルギー:[${al}] 嫌い:[${dl}] 好き:[${lk}]`;
  }).join('\n') || '- （メンバー情報なし）';

  const avoidText = {
    any: '誰か1人でも嫌いな食材は使用禁止',
    majority: '過半数が嫌いな食材は避ける',
    adjust: '嫌いな人には別メニューを提案して良い',
  }[p.avoidMode] || '誰か1人でも嫌いな食材は使用禁止';

  const allergyUnion = (p.householdAllergies || []).join('、') || 'なし';

  const favDesc = (p.favorites || []).length === 0
    ? '（過去のお気に入りなし。今回は新規レシピのみ提案）'
    : p.favorites.map(f => `- ${f.name}（評価${f.rating}・${f.cookCount}回・最終${f.lastCookedAt || '-'}）`).join('\n');

  const recentDesc = (p.recentlyCooked || []).length === 0 ? '（なし）' : p.recentlyCooked.join('、');
  const blockedDesc = (p.blocked || []).length === 0 ? '（なし）' : p.blocked.join('、');
  const stockDesc = (p.stockIngredients || []).length === 0 ? '（なし）' : p.stockIngredients.map(s => `${s.name}${s.estimatedAmount ? `(${s.estimatedAmount})` : ''}`).join('、');

  const seasonalList = (p.seasonalHint || []).join('、');

  return `あなたは日本の家庭料理を得意とする栄養士兼料理研究家です。以下の条件で献立を作ってください。出力はJSONスキーマに厳密に従うこと。

# 家族構成
${membersDesc}

# 【最優先】アレルギー食材（必ず完全除外）
${allergyUnion}

# 嫌い食材の扱い
${avoidText}

# 今月の旬食材（${p.month}月）
${seasonalList || 'なし（特に指定なし）'}

# 生成条件
- 日数: ${p.days}日
- 食事: 1日あたり「${mealList}」
- 調理時間の上限: ${p.maxCookTimeMin}分（※朝食は10分以内推奨）
- 気分: ${p.moodTag}
- 予算: 1日あたり約${p.budgetYen}円

# 厳守ルール
## 【時短】
- cookTimeMin は ${p.maxCookTimeMin} 分以下。朝食は10分以内。
- 工程は3〜5手順に収め、「切る→炒める→味付け」系の簡潔な流れに。
- 電子レンジ・フライパン1つで完結するレシピを優先。cookwareHint にヒントを書く。

${p.basicIngredientsOnly ? `## 【簡単材料】スーパーで普通に手に入る食材のみ使用
- 許可例: 肉（鶏/豚/牛/ひき肉）、魚（鮭/鯖/ツナ缶）、卵、豆腐、定番野菜、基本調味料（醤油/味噌/塩/砂糖/みりん/酒/酢/油/ケチャップ/マヨネーズ/ソース/めんつゆ/だしの素/コンソメ/鶏がらスープ/カレー粉）
- 禁止例: フレッシュハーブ、輸入スパイス、専門店食材、1パック500円超の食材
- 同じ食材を複数メニューで使い回すことを優先（ムダ買い削減）。` : ''}

${p.batchShopping ? `## 【ため買い】
- 1回のまとめ買いで${p.days}日分の食材が揃う構成にする。
- 各食材に shelfLifeDays（日持ち目安）と storage（常温/冷蔵/冷凍可）を必ず付ける。
- 日持ちしない食材（葉物野菜3日以内、生魚2日以内）は dayIndex が小さい日（1〜2日目）に配置。
- 冷凍可の肉類・ひき肉・パンは後半の日でも可。
- 残り食材の使い切りメニューを最終日に1つ入れ、useLeftover=true とする。` : ''}

${p.stockPriority && (p.stockIngredients || []).length > 0 ? `## 【在庫活用・最優先】
以下の食材が冷蔵庫にすでにあります。これらを**できるだけ使って**献立を組むこと。新規購入食材は最小限に。
在庫: ${stockDesc}` : ''}

## 【学習・マンネリ回避】
以下のお気に入りレシピから、状況に合うものを全品の30〜50%再登場させてください。判断基準:
(a) 最終調理が14日以上前なら再登場OK / 14日以内なら見送る
(b) 今月の旬と合致するなら優先度アップ
(c) cookCount が月3回超なら見送る
再登場させた場合は isFavorite=true、favoriteReason に理由を書く。

お気に入り候補:
${favDesc}

## 【直近14日に作ったレシピ】（再登場禁止）
${recentDesc}

## 【ブロック済みレシピ】（絶対に再提案しない・酷似メニューも不可）
${blockedDesc}

## 【その他】
- 連日で主菜の主食材（肉/魚）が被らないこと。
- 各食事のカロリー・塩分バランスを家族の年齢に合わせて調整。子供向けに辛味は控えめに。
- notes に「新規◯品＋お気に入り再登場◯品」のように内訳を書く。

では、献立をJSONで生成してください。`;
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

  const prompt = buildPrompt(payload);

  const geminiBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: OUTPUT_SCHEMA,
      temperature: 0.8,
      maxOutputTokens: 16384,
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
      if (!text) {
        lastError = 'Gemini レスポンスにテキストなし';
        continue;
      }
      let parsed;
      try { parsed = JSON.parse(text); }
      catch (e) { lastError = 'JSON parse 失敗: ' + e.message; continue; }
      if (!parsed.days || !Array.isArray(parsed.days)) {
        lastError = 'days 配列なし';
        continue;
      }
      return new Response(JSON.stringify(parsed), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      lastError = String(e);
    }
  }
  return new Response('生成失敗: ' + lastError, { status: 502 });
}
