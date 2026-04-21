/**
 * POST /api/detect-ingredients
 * 冷蔵庫・食品庫の写真（複数枚）から Gemini Vision で食材を総合判定。
 *
 * 入力（JSON）:
 *   { images: [{ mimeType: "image/jpeg", data: "<base64>" }, ...] }
 *
 * 出力（JSON）:
 *   { ingredients: [{ name, estimatedAmount, category, confidence, storage }], notes }
 */

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '食材名（例: 鶏もも肉、玉ねぎ、木綿豆腐）' },
          estimatedAmount: { type: 'string', description: '推定量（例: 1パック約400g、3個、半分）' },
          category: { type: 'string', description: '肉/魚/野菜/果物/乳製品/卵/豆腐/調味料/加工食品/その他' },
          confidence: { type: 'number', description: '0〜1の信頼度。パッケージで見えにくい・推定困難なものは低く' },
          storage: { type: 'string', description: '常温/冷蔵/冷凍 のいずれか' },
        },
        required: ['name', 'confidence'],
      },
    },
    notes: { type: 'string', description: '総合判断のコメント（認識が難しかった要因など）' },
  },
  required: ['ingredients'],
};

const PROMPT = `これから複数枚の冷蔵庫・野菜室・冷凍室・食品庫の写真を送ります。**すべての画像を総合的に判断して**、認識できた食材を一覧化してください。

指示:
- 同じ食材が複数の画像に写っている場合は重複させず1件にまとめる
- 推定量は見た目から大まかに（例: 「1パック約400g」「3個」「半分くらい」）
- パッケージやラップで中身が見えにくいもの、奥に隠れて不明瞭なものは confidence を 0.3〜0.5 と低めに
- はっきり見える新鮮な食材は confidence 0.8〜1.0
- 調味料（瓶・ボトル類）は基本的に省略。ただし特徴的で献立に影響しそうなもの（例: カレールー、味噌）は含める
- 各食材に storage（常温/冷蔵/冷凍）を撮影場所から推定して付与
- ドリンク類・お菓子・ペットフードなど料理に使わないものは含めない
- 生肉・生魚は衛生上重要なので優先的に検出する
- 確実に写っていないものを推測で挙げないこと
- notes に総合判断のコメント（枚数・認識が難しかった要因など）を書く

出力はJSONスキーマに厳密に従うこと。`;

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

  const images = payload.images;
  if (!Array.isArray(images) || images.length === 0) {
    return new Response('images 配列が必要です', { status: 400 });
  }
  if (images.length > 10) {
    return new Response('画像は10枚まで', { status: 400 });
  }

  const parts = [{ text: PROMPT }];
  for (const img of images) {
    if (!img.data) continue;
    parts.push({
      inlineData: { mimeType: img.mimeType || 'image/jpeg', data: img.data },
    });
  }

  const geminiBody = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: OUTPUT_SCHEMA,
      temperature: 0.4,
      maxOutputTokens: 4096,
    },
  };

  try {
    const res = await fetch(GEMINI_ENDPOINT(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 500);
      return new Response('Gemini API ' + res.status + ': ' + errText, { status: 502 });
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return new Response('Gemini レスポンス空', { status: 502 });
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return new Response('JSON parse 失敗: ' + e.message, { status: 502 }); }
    return new Response(JSON.stringify(parsed), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response('認識失敗: ' + String(e), { status: 502 });
  }
}
