var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/pages-YlsRuc/functionsWorker-0.10165519314322835.mjs
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var GEMINI_MODEL = "gemini-2.5-flash";
var GEMINI_ENDPOINT = /* @__PURE__ */ __name2((key) => `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`, "GEMINI_ENDPOINT");
var OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "\u98DF\u6750\u540D\uFF08\u4F8B: \u9D8F\u3082\u3082\u8089\u3001\u7389\u306D\u304E\u3001\u6728\u7DBF\u8C46\u8150\uFF09" },
          estimatedAmount: { type: "string", description: "\u63A8\u5B9A\u91CF\uFF08\u4F8B: 1\u30D1\u30C3\u30AF\u7D04400g\u30013\u500B\u3001\u534A\u5206\uFF09" },
          category: { type: "string", description: "\u8089/\u9B5A/\u91CE\u83DC/\u679C\u7269/\u4E73\u88FD\u54C1/\u5375/\u8C46\u8150/\u8ABF\u5473\u6599/\u52A0\u5DE5\u98DF\u54C1/\u305D\u306E\u4ED6" },
          confidence: { type: "number", description: "0\u301C1\u306E\u4FE1\u983C\u5EA6\u3002\u30D1\u30C3\u30B1\u30FC\u30B8\u3067\u898B\u3048\u306B\u304F\u3044\u30FB\u63A8\u5B9A\u56F0\u96E3\u306A\u3082\u306E\u306F\u4F4E\u304F" },
          storage: { type: "string", description: "\u5E38\u6E29/\u51B7\u8535/\u51B7\u51CD \u306E\u3044\u305A\u308C\u304B" }
        },
        required: ["name", "confidence"]
      }
    },
    notes: { type: "string", description: "\u7DCF\u5408\u5224\u65AD\u306E\u30B3\u30E1\u30F3\u30C8\uFF08\u8A8D\u8B58\u304C\u96E3\u3057\u304B\u3063\u305F\u8981\u56E0\u306A\u3069\uFF09" }
  },
  required: ["ingredients"]
};
var PROMPT = `\u3053\u308C\u304B\u3089\u8907\u6570\u679A\u306E\u51B7\u8535\u5EAB\u30FB\u91CE\u83DC\u5BA4\u30FB\u51B7\u51CD\u5BA4\u30FB\u98DF\u54C1\u5EAB\u306E\u5199\u771F\u3092\u9001\u308A\u307E\u3059\u3002**\u3059\u3079\u3066\u306E\u753B\u50CF\u3092\u7DCF\u5408\u7684\u306B\u5224\u65AD\u3057\u3066**\u3001\u8A8D\u8B58\u3067\u304D\u305F\u98DF\u6750\u3092\u4E00\u89A7\u5316\u3057\u3066\u304F\u3060\u3055\u3044\u3002

\u6307\u793A:
- \u540C\u3058\u98DF\u6750\u304C\u8907\u6570\u306E\u753B\u50CF\u306B\u5199\u3063\u3066\u3044\u308B\u5834\u5408\u306F\u91CD\u8907\u3055\u305B\u305A1\u4EF6\u306B\u307E\u3068\u3081\u308B
- \u63A8\u5B9A\u91CF\u306F\u898B\u305F\u76EE\u304B\u3089\u5927\u307E\u304B\u306B\uFF08\u4F8B: \u300C1\u30D1\u30C3\u30AF\u7D04400g\u300D\u300C3\u500B\u300D\u300C\u534A\u5206\u304F\u3089\u3044\u300D\uFF09
- \u30D1\u30C3\u30B1\u30FC\u30B8\u3084\u30E9\u30C3\u30D7\u3067\u4E2D\u8EAB\u304C\u898B\u3048\u306B\u304F\u3044\u3082\u306E\u3001\u5965\u306B\u96A0\u308C\u3066\u4E0D\u660E\u77AD\u306A\u3082\u306E\u306F confidence \u3092 0.3\u301C0.5 \u3068\u4F4E\u3081\u306B
- \u306F\u3063\u304D\u308A\u898B\u3048\u308B\u65B0\u9BAE\u306A\u98DF\u6750\u306F confidence 0.8\u301C1.0
- \u8ABF\u5473\u6599\uFF08\u74F6\u30FB\u30DC\u30C8\u30EB\u985E\uFF09\u306F\u57FA\u672C\u7684\u306B\u7701\u7565\u3002\u305F\u3060\u3057\u7279\u5FB4\u7684\u3067\u732E\u7ACB\u306B\u5F71\u97FF\u3057\u305D\u3046\u306A\u3082\u306E\uFF08\u4F8B: \u30AB\u30EC\u30FC\u30EB\u30FC\u3001\u5473\u564C\uFF09\u306F\u542B\u3081\u308B
- \u5404\u98DF\u6750\u306B storage\uFF08\u5E38\u6E29/\u51B7\u8535/\u51B7\u51CD\uFF09\u3092\u64AE\u5F71\u5834\u6240\u304B\u3089\u63A8\u5B9A\u3057\u3066\u4ED8\u4E0E
- \u30C9\u30EA\u30F3\u30AF\u985E\u30FB\u304A\u83D3\u5B50\u30FB\u30DA\u30C3\u30C8\u30D5\u30FC\u30C9\u306A\u3069\u6599\u7406\u306B\u4F7F\u308F\u306A\u3044\u3082\u306E\u306F\u542B\u3081\u306A\u3044
- \u751F\u8089\u30FB\u751F\u9B5A\u306F\u885B\u751F\u4E0A\u91CD\u8981\u306A\u306E\u3067\u512A\u5148\u7684\u306B\u691C\u51FA\u3059\u308B
- \u78BA\u5B9F\u306B\u5199\u3063\u3066\u3044\u306A\u3044\u3082\u306E\u3092\u63A8\u6E2C\u3067\u6319\u3052\u306A\u3044\u3053\u3068
- notes \u306B\u7DCF\u5408\u5224\u65AD\u306E\u30B3\u30E1\u30F3\u30C8\uFF08\u679A\u6570\u30FB\u8A8D\u8B58\u304C\u96E3\u3057\u304B\u3063\u305F\u8981\u56E0\u306A\u3069\uFF09\u3092\u66F8\u304F

\u51FA\u529B\u306FJSON\u30B9\u30AD\u30FC\u30DE\u306B\u53B3\u5BC6\u306B\u5F93\u3046\u3053\u3068\u3002`;
async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response("GEMINI_API_KEY \u304C\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093", { status: 500 });
  }
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response("\u4E0D\u6B63\u306AJSON", { status: 400 });
  }
  const images = payload.images;
  if (!Array.isArray(images) || images.length === 0) {
    return new Response("images \u914D\u5217\u304C\u5FC5\u8981\u3067\u3059", { status: 400 });
  }
  if (images.length > 10) {
    return new Response("\u753B\u50CF\u306F10\u679A\u307E\u3067", { status: 400 });
  }
  const parts = [{ text: PROMPT }];
  for (const img of images) {
    if (!img.data) continue;
    parts.push({
      inlineData: { mimeType: img.mimeType || "image/jpeg", data: img.data }
    });
  }
  const geminiBody = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: OUTPUT_SCHEMA,
      temperature: 0.4,
      maxOutputTokens: 4096
    }
  };
  try {
    const res = await fetch(GEMINI_ENDPOINT(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody)
    });
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 500);
      return new Response("Gemini API " + res.status + ": " + errText, { status: 502 });
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return new Response("Gemini \u30EC\u30B9\u30DD\u30F3\u30B9\u7A7A", { status: 502 });
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return new Response("JSON parse \u5931\u6557: " + e.message, { status: 502 });
    }
    return new Response(JSON.stringify(parsed), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response("\u8A8D\u8B58\u5931\u6557: " + String(e), { status: 502 });
  }
}
__name(onRequestPost, "onRequestPost");
__name2(onRequestPost, "onRequestPost");
var GEMINI_MODEL2 = "gemini-2.5-flash";
var GEMINI_ENDPOINT2 = /* @__PURE__ */ __name2((key) => `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL2}:generateContent?key=${key}`, "GEMINI_ENDPOINT");
var MEAL_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    category: { type: "string", description: "\u4E3B\u83DC/\u526F\u83DC/\u6C41\u7269/\u4E3B\u98DF" },
    cookTimeMin: { type: "integer" },
    servings: { type: "integer" },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "number" },
          unit: { type: "string" },
          shelfLifeDays: { type: "integer" },
          storage: { type: "string", description: "\u5E38\u6E29/\u51B7\u8535/\u51B7\u51CD\u53EF" }
        },
        required: ["name"]
      }
    },
    steps: { type: "array", items: { type: "string" } },
    seasonalReason: { type: "string" },
    useLeftover: { type: "boolean" },
    cookwareHint: { type: "string" },
    isFavorite: { type: "boolean" },
    favoriteReason: { type: "string" }
  },
  required: ["name", "cookTimeMin", "ingredients", "steps"]
};
var OUTPUT_SCHEMA2 = {
  type: "object",
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dayIndex: { type: "integer" },
          meals: {
            type: "object",
            properties: {
              breakfast: MEAL_SCHEMA,
              lunch: MEAL_SCHEMA,
              dinner: MEAL_SCHEMA
            }
          }
        },
        required: ["dayIndex", "meals"]
      }
    },
    totalBudgetYen: { type: "integer" },
    notes: { type: "string" }
  },
  required: ["days"]
};
function buildPrompt(p) {
  const mealLabel = { breakfast: "\u671D\u98DF", lunch: "\u663C\u98DF", dinner: "\u5915\u98DF" };
  const mealList = (p.mealTypes || ["dinner"]).map((m) => mealLabel[m] || m).join("\u30FB");
  const membersDesc = (p.members || []).map((m) => {
    const kindLabel = m.kind === "child" ? "\u5B50\u4F9B" : "\u5927\u4EBA";
    const ageLabel = m.age ? `${m.age}\u6B73` : "";
    const al = (m.allergies || []).join("\u3001") || "\u306A\u3057";
    const dl = (m.dislikes || []).join("\u3001") || "\u306A\u3057";
    const lk = (m.likes || []).join("\u3001") || "\u306A\u3057";
    return `- ${m.name}\uFF08${kindLabel}\u30FB${ageLabel}\uFF09\u30A2\u30EC\u30EB\u30AE\u30FC:[${al}] \u5ACC\u3044:[${dl}] \u597D\u304D:[${lk}]`;
  }).join("\n") || "- \uFF08\u30E1\u30F3\u30D0\u30FC\u60C5\u5831\u306A\u3057\uFF09";
  const avoidText = {
    any: "\u8AB0\u304B1\u4EBA\u3067\u3082\u5ACC\u3044\u306A\u98DF\u6750\u306F\u4F7F\u7528\u7981\u6B62",
    majority: "\u904E\u534A\u6570\u304C\u5ACC\u3044\u306A\u98DF\u6750\u306F\u907F\u3051\u308B",
    adjust: "\u5ACC\u3044\u306A\u4EBA\u306B\u306F\u5225\u30E1\u30CB\u30E5\u30FC\u3092\u63D0\u6848\u3057\u3066\u826F\u3044"
  }[p.avoidMode] || "\u8AB0\u304B1\u4EBA\u3067\u3082\u5ACC\u3044\u306A\u98DF\u6750\u306F\u4F7F\u7528\u7981\u6B62";
  const allergyUnion = (p.householdAllergies || []).join("\u3001") || "\u306A\u3057";
  const favDesc = (p.favorites || []).length === 0 ? "\uFF08\u904E\u53BB\u306E\u304A\u6C17\u306B\u5165\u308A\u306A\u3057\u3002\u4ECA\u56DE\u306F\u65B0\u898F\u30EC\u30B7\u30D4\u306E\u307F\u63D0\u6848\uFF09" : p.favorites.map((f) => `- ${f.name}\uFF08\u8A55\u4FA1${f.rating}\u30FB${f.cookCount}\u56DE\u30FB\u6700\u7D42${f.lastCookedAt || "-"}\uFF09`).join("\n");
  const recentDesc = (p.recentlyCooked || []).length === 0 ? "\uFF08\u306A\u3057\uFF09" : p.recentlyCooked.join("\u3001");
  const blockedDesc = (p.blocked || []).length === 0 ? "\uFF08\u306A\u3057\uFF09" : p.blocked.join("\u3001");
  const stockDesc = (p.stockIngredients || []).length === 0 ? "\uFF08\u306A\u3057\uFF09" : p.stockIngredients.map((s) => `${s.name}${s.estimatedAmount ? `(${s.estimatedAmount})` : ""}`).join("\u3001");
  const seasonalList = (p.seasonalHint || []).join("\u3001");
  return `\u3042\u306A\u305F\u306F\u65E5\u672C\u306E\u5BB6\u5EAD\u6599\u7406\u3092\u5F97\u610F\u3068\u3059\u308B\u6804\u990A\u58EB\u517C\u6599\u7406\u7814\u7A76\u5BB6\u3067\u3059\u3002\u4EE5\u4E0B\u306E\u6761\u4EF6\u3067\u732E\u7ACB\u3092\u4F5C\u3063\u3066\u304F\u3060\u3055\u3044\u3002\u51FA\u529B\u306FJSON\u30B9\u30AD\u30FC\u30DE\u306B\u53B3\u5BC6\u306B\u5F93\u3046\u3053\u3068\u3002

# \u5BB6\u65CF\u69CB\u6210
${membersDesc}

# \u3010\u6700\u512A\u5148\u3011\u30A2\u30EC\u30EB\u30AE\u30FC\u98DF\u6750\uFF08\u5FC5\u305A\u5B8C\u5168\u9664\u5916\uFF09
${allergyUnion}

# \u5ACC\u3044\u98DF\u6750\u306E\u6271\u3044
${avoidText}

# \u4ECA\u6708\u306E\u65EC\u98DF\u6750\uFF08${p.month}\u6708\uFF09
${seasonalList || "\u306A\u3057\uFF08\u7279\u306B\u6307\u5B9A\u306A\u3057\uFF09"}

# \u751F\u6210\u6761\u4EF6
- \u65E5\u6570: ${p.days}\u65E5
- \u98DF\u4E8B: 1\u65E5\u3042\u305F\u308A\u300C${mealList}\u300D
- \u8ABF\u7406\u6642\u9593\u306E\u4E0A\u9650: ${p.maxCookTimeMin}\u5206\uFF08\u203B\u671D\u98DF\u306F10\u5206\u4EE5\u5185\u63A8\u5968\uFF09
- \u6C17\u5206: ${p.moodTag}
- \u4E88\u7B97: 1\u65E5\u3042\u305F\u308A\u7D04${p.budgetYen}\u5186

# \u53B3\u5B88\u30EB\u30FC\u30EB
## \u3010\u6642\u77ED\u3011
- cookTimeMin \u306F ${p.maxCookTimeMin} \u5206\u4EE5\u4E0B\u3002\u671D\u98DF\u306F10\u5206\u4EE5\u5185\u3002
- \u5DE5\u7A0B\u306F3\u301C5\u624B\u9806\u306B\u53CE\u3081\u3001\u300C\u5207\u308B\u2192\u7092\u3081\u308B\u2192\u5473\u4ED8\u3051\u300D\u7CFB\u306E\u7C21\u6F54\u306A\u6D41\u308C\u306B\u3002
- \u96FB\u5B50\u30EC\u30F3\u30B8\u30FB\u30D5\u30E9\u30A4\u30D1\u30F31\u3064\u3067\u5B8C\u7D50\u3059\u308B\u30EC\u30B7\u30D4\u3092\u512A\u5148\u3002cookwareHint \u306B\u30D2\u30F3\u30C8\u3092\u66F8\u304F\u3002

${p.basicIngredientsOnly ? `## \u3010\u7C21\u5358\u6750\u6599\u3011\u30B9\u30FC\u30D1\u30FC\u3067\u666E\u901A\u306B\u624B\u306B\u5165\u308B\u98DF\u6750\u306E\u307F\u4F7F\u7528
- \u8A31\u53EF\u4F8B: \u8089\uFF08\u9D8F/\u8C5A/\u725B/\u3072\u304D\u8089\uFF09\u3001\u9B5A\uFF08\u9BAD/\u9BD6/\u30C4\u30CA\u7F36\uFF09\u3001\u5375\u3001\u8C46\u8150\u3001\u5B9A\u756A\u91CE\u83DC\u3001\u57FA\u672C\u8ABF\u5473\u6599\uFF08\u91A4\u6CB9/\u5473\u564C/\u5869/\u7802\u7CD6/\u307F\u308A\u3093/\u9152/\u9162/\u6CB9/\u30B1\u30C1\u30E3\u30C3\u30D7/\u30DE\u30E8\u30CD\u30FC\u30BA/\u30BD\u30FC\u30B9/\u3081\u3093\u3064\u3086/\u3060\u3057\u306E\u7D20/\u30B3\u30F3\u30BD\u30E1/\u9D8F\u304C\u3089\u30B9\u30FC\u30D7/\u30AB\u30EC\u30FC\u7C89\uFF09
- \u7981\u6B62\u4F8B: \u30D5\u30EC\u30C3\u30B7\u30E5\u30CF\u30FC\u30D6\u3001\u8F38\u5165\u30B9\u30D1\u30A4\u30B9\u3001\u5C02\u9580\u5E97\u98DF\u6750\u30011\u30D1\u30C3\u30AF500\u5186\u8D85\u306E\u98DF\u6750
- \u540C\u3058\u98DF\u6750\u3092\u8907\u6570\u30E1\u30CB\u30E5\u30FC\u3067\u4F7F\u3044\u56DE\u3059\u3053\u3068\u3092\u512A\u5148\uFF08\u30E0\u30C0\u8CB7\u3044\u524A\u6E1B\uFF09\u3002` : ""}

${p.batchShopping ? `## \u3010\u305F\u3081\u8CB7\u3044\u3011
- 1\u56DE\u306E\u307E\u3068\u3081\u8CB7\u3044\u3067${p.days}\u65E5\u5206\u306E\u98DF\u6750\u304C\u63C3\u3046\u69CB\u6210\u306B\u3059\u308B\u3002
- \u5404\u98DF\u6750\u306B shelfLifeDays\uFF08\u65E5\u6301\u3061\u76EE\u5B89\uFF09\u3068 storage\uFF08\u5E38\u6E29/\u51B7\u8535/\u51B7\u51CD\u53EF\uFF09\u3092\u5FC5\u305A\u4ED8\u3051\u308B\u3002
- \u65E5\u6301\u3061\u3057\u306A\u3044\u98DF\u6750\uFF08\u8449\u7269\u91CE\u83DC3\u65E5\u4EE5\u5185\u3001\u751F\u9B5A2\u65E5\u4EE5\u5185\uFF09\u306F dayIndex \u304C\u5C0F\u3055\u3044\u65E5\uFF081\u301C2\u65E5\u76EE\uFF09\u306B\u914D\u7F6E\u3002
- \u51B7\u51CD\u53EF\u306E\u8089\u985E\u30FB\u3072\u304D\u8089\u30FB\u30D1\u30F3\u306F\u5F8C\u534A\u306E\u65E5\u3067\u3082\u53EF\u3002
- \u6B8B\u308A\u98DF\u6750\u306E\u4F7F\u3044\u5207\u308A\u30E1\u30CB\u30E5\u30FC\u3092\u6700\u7D42\u65E5\u306B1\u3064\u5165\u308C\u3001useLeftover=true \u3068\u3059\u308B\u3002` : ""}

${p.stockPriority && (p.stockIngredients || []).length > 0 ? `## \u3010\u5728\u5EAB\u6D3B\u7528\u30FB\u6700\u512A\u5148\u3011
\u4EE5\u4E0B\u306E\u98DF\u6750\u304C\u51B7\u8535\u5EAB\u306B\u3059\u3067\u306B\u3042\u308A\u307E\u3059\u3002\u3053\u308C\u3089\u3092**\u3067\u304D\u308B\u3060\u3051\u4F7F\u3063\u3066**\u732E\u7ACB\u3092\u7D44\u3080\u3053\u3068\u3002\u65B0\u898F\u8CFC\u5165\u98DF\u6750\u306F\u6700\u5C0F\u9650\u306B\u3002
\u5728\u5EAB: ${stockDesc}` : ""}

## \u3010\u5B66\u7FD2\u30FB\u30DE\u30F3\u30CD\u30EA\u56DE\u907F\u3011
\u4EE5\u4E0B\u306E\u304A\u6C17\u306B\u5165\u308A\u30EC\u30B7\u30D4\u304B\u3089\u3001\u72B6\u6CC1\u306B\u5408\u3046\u3082\u306E\u3092\u5168\u54C1\u306E30\u301C50%\u518D\u767B\u5834\u3055\u305B\u3066\u304F\u3060\u3055\u3044\u3002\u5224\u65AD\u57FA\u6E96:
(a) \u6700\u7D42\u8ABF\u7406\u304C14\u65E5\u4EE5\u4E0A\u524D\u306A\u3089\u518D\u767B\u5834OK / 14\u65E5\u4EE5\u5185\u306A\u3089\u898B\u9001\u308B
(b) \u4ECA\u6708\u306E\u65EC\u3068\u5408\u81F4\u3059\u308B\u306A\u3089\u512A\u5148\u5EA6\u30A2\u30C3\u30D7
(c) cookCount \u304C\u67083\u56DE\u8D85\u306A\u3089\u898B\u9001\u308B
\u518D\u767B\u5834\u3055\u305B\u305F\u5834\u5408\u306F isFavorite=true\u3001favoriteReason \u306B\u7406\u7531\u3092\u66F8\u304F\u3002

\u304A\u6C17\u306B\u5165\u308A\u5019\u88DC:
${favDesc}

## \u3010\u76F4\u8FD114\u65E5\u306B\u4F5C\u3063\u305F\u30EC\u30B7\u30D4\u3011\uFF08\u518D\u767B\u5834\u7981\u6B62\uFF09
${recentDesc}

## \u3010\u30D6\u30ED\u30C3\u30AF\u6E08\u307F\u30EC\u30B7\u30D4\u3011\uFF08\u7D76\u5BFE\u306B\u518D\u63D0\u6848\u3057\u306A\u3044\u30FB\u9177\u4F3C\u30E1\u30CB\u30E5\u30FC\u3082\u4E0D\u53EF\uFF09
${blockedDesc}

## \u3010\u305D\u306E\u4ED6\u3011
- \u9023\u65E5\u3067\u4E3B\u83DC\u306E\u4E3B\u98DF\u6750\uFF08\u8089/\u9B5A\uFF09\u304C\u88AB\u3089\u306A\u3044\u3053\u3068\u3002
- \u5404\u98DF\u4E8B\u306E\u30AB\u30ED\u30EA\u30FC\u30FB\u5869\u5206\u30D0\u30E9\u30F3\u30B9\u3092\u5BB6\u65CF\u306E\u5E74\u9F62\u306B\u5408\u308F\u305B\u3066\u8ABF\u6574\u3002\u5B50\u4F9B\u5411\u3051\u306B\u8F9B\u5473\u306F\u63A7\u3048\u3081\u306B\u3002
- notes \u306B\u300C\u65B0\u898F\u25EF\u54C1\uFF0B\u304A\u6C17\u306B\u5165\u308A\u518D\u767B\u5834\u25EF\u54C1\u300D\u306E\u3088\u3046\u306B\u5185\u8A33\u3092\u66F8\u304F\u3002

\u3067\u306F\u3001\u732E\u7ACB\u3092JSON\u3067\u751F\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002`;
}
__name(buildPrompt, "buildPrompt");
__name2(buildPrompt, "buildPrompt");
async function onRequestPost2(context) {
  const { request, env } = context;
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response("GEMINI_API_KEY \u304C\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093", { status: 500 });
  }
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response("\u4E0D\u6B63\u306AJSON", { status: 400 });
  }
  const prompt = buildPrompt(payload);
  const geminiBody = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: OUTPUT_SCHEMA2,
      temperature: 0.8,
      maxOutputTokens: 16384
    }
  };
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(GEMINI_ENDPOINT2(apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody)
      });
      if (!res.ok) {
        lastError = "Gemini API " + res.status + ": " + (await res.text()).slice(0, 300);
        continue;
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        lastError = "Gemini \u30EC\u30B9\u30DD\u30F3\u30B9\u306B\u30C6\u30AD\u30B9\u30C8\u306A\u3057";
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        lastError = "JSON parse \u5931\u6557: " + e.message;
        continue;
      }
      if (!parsed.days || !Array.isArray(parsed.days)) {
        lastError = "days \u914D\u5217\u306A\u3057";
        continue;
      }
      return new Response(JSON.stringify(parsed), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      lastError = String(e);
    }
  }
  return new Response("\u751F\u6210\u5931\u6557: " + lastError, { status: 502 });
}
__name(onRequestPost2, "onRequestPost2");
__name2(onRequestPost2, "onRequestPost");
var routes = [
  {
    routePath: "/api/detect-ingredients",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/generate",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  }
];
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
__name2(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name2(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name2(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name2(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name2(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name2(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
__name2(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
__name2(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name2(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
__name2(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
__name2(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
__name2(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
__name2(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
__name2(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
__name2(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
__name2(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");
__name2(pathToRegexp, "pathToRegexp");
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
__name2(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name2(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name2(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name2((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
var drainBody = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
__name2(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
__name2(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
__name2(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");
__name2(__facade_invoke__, "__facade_invoke__");
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  static {
    __name(this, "___Facade_ScheduledController__");
  }
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name2(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name2(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name2(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
__name2(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name2((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name2((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
__name2(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;

// ../../../../.local/npm-global/lib/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default2 = drainBody2;

// ../../../../.local/npm-global/lib/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError2(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError2(e.cause)
  };
}
__name(reduceError2, "reduceError");
var jsonError2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError2(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default2 = jsonError2;

// .wrangler/tmp/bundle-d1Ktpo/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__2 = [
  middleware_ensure_req_body_drained_default2,
  middleware_miniflare3_json_error_default2
];
var middleware_insertion_facade_default2 = middleware_loader_entry_default;

// ../../../../.local/npm-global/lib/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__2 = [];
function __facade_register__2(...args) {
  __facade_middleware__2.push(...args.flat());
}
__name(__facade_register__2, "__facade_register__");
function __facade_invokeChain__2(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__2(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__2, "__facade_invokeChain__");
function __facade_invoke__2(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__2(request, env, ctx, dispatch, [
    ...__facade_middleware__2,
    finalMiddleware
  ]);
}
__name(__facade_invoke__2, "__facade_invoke__");

// .wrangler/tmp/bundle-d1Ktpo/middleware-loader.entry.ts
var __Facade_ScheduledController__2 = class ___Facade_ScheduledController__2 {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__2)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler2(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__2(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__2(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler2, "wrapExportedHandler");
function wrapWorkerEntrypoint2(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__2(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__2(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint2, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY2;
if (typeof middleware_insertion_facade_default2 === "object") {
  WRAPPED_ENTRY2 = wrapExportedHandler2(middleware_insertion_facade_default2);
} else if (typeof middleware_insertion_facade_default2 === "function") {
  WRAPPED_ENTRY2 = wrapWorkerEntrypoint2(middleware_insertion_facade_default2);
}
var middleware_loader_entry_default2 = WRAPPED_ENTRY2;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__2 as __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default2 as default
};
//# sourceMappingURL=functionsWorker-0.10165519314322835.js.map
