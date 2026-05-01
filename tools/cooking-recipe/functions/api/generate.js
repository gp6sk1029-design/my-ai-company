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
    cuisine: { type: 'string', description: 'japanese/chinese/western/italian/korean/ethnic/donburi' },
    cookTimeMin: { type: 'integer' },
    servings: { type: 'integer' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '食材名または市販品の具体的な製品名（例: 味の素 Cook Do「回鍋肉用」）' },
          amount: { type: 'number' },
          unit: { type: 'string' },
          shelfLifeDays: { type: 'integer' },
          storage: { type: 'string', description: '常温/冷蔵/冷凍可' },
          isCommercial: { type: 'boolean', description: 'trueなら市販の合わせ調味料・ソース' },
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
    usesCommercialSauce: { type: 'boolean', description: '市販の合わせ調味料を使っている場合 true' },
    commercialProductNote: { type: 'string', description: '使用する市販品の説明（例: 「Cook Do 青椒肉絲用 1箱」）' },
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

// ------------ ヘルパー ------------
function cuisineDirective(c) {
  const map = {
    any: '指定なし（バラエティ重視で）',
    japanese: '和食中心（主菜は和風の肉魚料理＋副菜は和え物/煮物/お浸し、汁物は味噌汁など）',
    chinese: '中華中心（炒め物・餃子・麻婆系・中華スープ）',
    western: '洋食中心（グラタン/ハンバーグ/ポークソテー/シチュー/ミートボール/オムライス）',
    italian: 'イタリアン中心（パスタ／ピザ風／チキンソテー／トマト煮）',
    korean: '韓国料理中心（プルコギ/ビビンバ/チャプチェ/チゲ/韓国風鶏）',
    ethnic: 'エスニック中心（タイ/ベトナム/インド風 カレー・炒め物・フォー）',
    donburi: '丼もの・麺類中心（親子丼・牛丼・カツ丼・焼きそば・うどん・ラーメン）',
    mixed: '日ごとにジャンルを変える（1日目和食・2日目中華・3日目洋食 など日替わり）',
  };
  return map[c] || map.any;
}

function cuisineBlock(c) {
  if (c === 'mixed') {
    return '- 連日でジャンルを意図的に変える（例: 1日目和食→2日目中華→3日目洋食）。単調さ回避のための最重要ルール。';
  }
  if (c === 'any' || !c) {
    return '- ジャンル指定なし。連日で同じジャンルが続かないように適度に散らす。';
  }
  const map = {
    japanese: '- すべて和食で統一する。主菜は魚/肉の和風（照り焼き/生姜焼き/煮付け等）、副菜は和え物・お浸し・酢の物、汁物は味噌汁を基本にする。',
    chinese: '- すべて中華で統一する。主菜は炒め物（回鍋肉/青椒肉絲/麻婆/エビチリ）、副菜は中華和え・春雨サラダ、汁物は卵スープ・中華スープ。',
    western: '- すべて洋食で統一する。主菜はハンバーグ/ポークソテー/シチュー/グラタン、副菜はサラダ/マリネ/コールスロー、汁物はコンソメ/ポタージュ。',
    italian: '- すべてイタリアンで統一する。主菜はパスタ/チキンソテー/トマト煮込み、副菜はカプレーゼ/サラダ、汁物はミネストローネ。',
    korean: '- すべて韓国料理で統一する。主菜はプルコギ/ヤンニョムチキン/チャプチェ、副菜はキムチ/ナムル、汁物はわかめスープ/スンドゥブ。',
    ethnic: '- エスニック料理で統一する。タイカレー/ガパオ/ナシゴレン/フォー/バインミー等。辛さは子供に合わせて調整。',
    donburi: '- 丼・麺中心。主菜＝丼 or 麺で主食兼ね、副菜1品＋汁物の2〜3品構成にして時短。',
  };
  return map[c] || '- ジャンル指定なし。';
}

function buildMealSettingsBlock(p) {
  const labels = { breakfast: '🌅 朝食', lunch: '🍱 昼食', dinner: '🌙 夕食' };
  const diffLabel = {
    easy: 'かんたん（工程最小・市販品/レンチン活用）',
    normal: 'ふつう（定番の家庭料理レベル）',
    elaborate: '本格（少し手間をかける・休日向け）',
  };
  const portionLabel = {
    less: '少なめ・品数少（主菜のみ、または2品構成）',
    normal: 'ふつう（主菜＋副菜1〜2品＋汁物）',
    more: '多め・品数多（主菜＋副菜2品＋汁物、さらに翌日弁当用の作り置き考慮）',
  };
  const ms = p.mealSettings || {};
  const lines = [];
  ['breakfast', 'lunch', 'dinner'].forEach(mt => {
    const s = ms[mt];
    if (!s) return;
    lines.push(`### ${labels[mt]}`);
    lines.push(`- 調理時間: **${s.maxCookTimeMin}分以内** （厳守。超えたら無効）`);
    lines.push(`- 難易度: ${diffLabel[s.difficulty] || s.difficulty}`);
    lines.push(`- 量・品数: ${portionLabel[s.portion] || s.portion}`);
    if (mt === 'breakfast') lines.push(`- 追加: 忙しい朝向けに電子レンジ or 焼くだけ・ワンプレート推奨。`);
    if (mt === 'lunch') lines.push(`- 追加: 弁当にもできる／冷めても美味しいメニューが◎。`);
    if (mt === 'dinner') lines.push(`- 追加: 家族団らんのメイン。栄養バランス重視。`);
  });
  return lines.join('\n') || '- （食事別設定なし）';
}

// 症状キー → AIへのヒント文（クライアントには露出させずサーバー側で解決）
const SYMPTOM_HINTS = {
  cold:     { label: '風邪',           hint: '温かく消化に良い・水分多め（おかゆ・卵雑炊・うどん・鶏スープ・煮込みうどん等）。生もの・揚げ物・刺激物は避ける。' },
  stomach:  { label: '胃腸炎・胃もたれ', hint: '油控えめ・刺激物（香辛料・酸・カフェイン）なし・柔らかい（おかゆ・蒸し野菜・白身魚・湯豆腐・りんごのすりおろし等）。乳製品・脂質の多い肉は控える。' },
  fever:    { label: '発熱',           hint: '食べやすく水分補給を兼ねる（雑炊・スープ・ゼリー・素うどん・ポカリ系）。消化早く冷ましやすい状態で提供。' },
  mouth:    { label: '口内炎・歯痛',     hint: '噛む量少なめ・塩味/酸味/辛味の刺激なし・温度はぬるめ（茶碗蒸し・ポタージュ・豆腐・やわらかいうどん・バナナ等）。' },
  summer:   { label: '夏バテ・食欲不振',  hint: 'さっぱり・酢や薬味で食欲増進・冷製OK（冷やし中華・冷ややっこ・梅しらす丼・トマトと豚しゃぶサラダ・素麺等）。脂っこいものは避ける。' },
  hangover: { label: '二日酔い',         hint: '水分・タンパク質・優しい味（しじみ味噌汁・湯豆腐・卵雑炊・お粥・うどん）。アルコール・辛味・脂質は避ける。' },
  allergy:  { label: 'アレルギー悪化',    hint: 'アレルゲン回避を強化。ヒスタミン誘発食材（青魚・発酵食品・ナッツ・チョコ等）にも注意し、温かくシンプルな調理で皮膚や粘膜への負担を減らす。' },
  other:    { label: 'その他',           hint: '本人のメモ欄の指示を最優先で反映する。' },
};

function buildHealthIssueBlock(members) {
  const sick = (members || []).filter(m => m.healthIssue && m.healthIssue.symptom);
  if (sick.length === 0) return '';
  const lines = sick.map(m => {
    const hi = m.healthIssue;
    const def = SYMPTOM_HINTS[hi.symptom] || SYMPTOM_HINTS.other;
    const remain = (hi.remainingDays === null || hi.remainingDays === undefined)
      ? '治るまで継続中'
      : `あと約${hi.remainingDays}日`;
    const note = hi.note ? `／本人メモ: 「${hi.note}」` : '';
    return `- ${m.name}: ${def.label}（${remain}）${note}\n  → ${def.hint}`;
  });
  return `# 【体調不良の家族】配慮必須
以下の家族は体調不良中です。期間内は献立に必ず配慮してください。

${lines.join('\n')}

## 体調不良配慮の方針
- 体調不良者と健康な家族で**別メニューに分けるかは状況判断**:
  (a) 健康家族のメインを少しアレンジで対応できそう（例: 揚げ物→焼き物に変更、辛さを抜く）なら**全員共通＋アレンジ案を steps に併記**して効率重視。
  (b) 共通化が無理（例: 胃腸炎で全員カレーは厳しい）なら、その人専用の**別メニュー**を提案し name 末尾に「（〇〇さん用）」と明記する。
- 体調不良者向けメニューは原則 cookTimeMin を 15分以内に抑え、「無理なく食べきれる量」を優先（servings は控えめに）。
- アレルギー食材は健康時と変わらず**完全除外**（最優先ルール）。
- 通知系の出力は notes 欄に「体調不良配慮: 〇〇さん（症状）→対応した内容」を明記。
`;
}

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
    const healthMark = m.healthIssue ? ' 🤒体調不良中' : '';
    return `- ${m.name}（${kindLabel}・${ageLabel}）アレルギー:[${al}] 嫌い:[${dl}] 好き:[${lk}]${healthMark}`;
  }).join('\n') || '- （メンバー情報なし）';

  const healthBlock = buildHealthIssueBlock(p.members);

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

${healthBlock}

# 嫌い食材の扱い
${avoidText}

# 今月の旬食材（${p.month}月）
${seasonalList || 'なし（特に指定なし）'}

# 生成条件
- 日数: ${p.days}日
- 食事: 1日あたり「${mealList}」
- 調理時間の上限: ${p.maxCookTimeMin}分（※朝食は10分以内推奨）
- 気分: ${p.moodTag}
- ジャンル: ${cuisineDirective(p.cuisine)}
- 予算: 1日あたり約${p.budgetYen}円

# 厳守ルール
## 【食事別の個別条件】
${buildMealSettingsBlock(p)}

## 【時短】
- 工程は3〜5手順に収め、「切る→炒める→味付け」系の簡潔な流れに。
- 電子レンジ・フライパン1つで完結するレシピを優先。cookwareHint にヒントを書く。

## 【ジャンル】
${cuisineBlock(p.cuisine)}
- 各メニューの cuisine フィールドに「japanese / chinese / western / italian / korean / ethnic / donburi」のいずれかを必ず入れる。

${p.basicIngredientsOnly ? `## 【簡単材料】スーパーで普通に手に入る食材のみ使用
- 許可例: 肉（鶏/豚/牛/ひき肉）、魚（鮭/鯖/ツナ缶）、卵、豆腐、定番野菜、基本調味料（醤油/味噌/塩/砂糖/みりん/酒/酢/油/ケチャップ/マヨネーズ/ソース/めんつゆ/だしの素/コンソメ/鶏がらスープ/カレー粉）
- 禁止例: フレッシュハーブ、輸入スパイス、専門店食材、1パック500円超の食材
- 同じ食材を複数メニューで使い回すことを優先（ムダ買い削減）。` : ''}

${p.useCommercialSauces ? `## 【市販の合わせ調味料・ソース活用】（積極的に使って時短）
時短効果が高いメニューでは、以下のような市販の合わせ調味料・ソースを**積極的に使う**こと。使う場合は**具体的な製品名を必ず ingredients[].name に明記**し、isCommercial=true、さらに usesCommercialSauce=true、commercialProductNote に詳細（内容量・入数）を記載。

推奨製品カタログ（日本のスーパーで常備）:
### 中華
- 味の素「Cook Do」: 回鍋肉用／青椒肉絲用／麻婆豆腐用（甘口/中辛/辛口）／麻婆茄子用／酢豚用／八宝菜用／エビチリ用／五目炒飯用／中華合わせ調味料
- 丸美屋「麻婆豆腐の素」（甘口/中辛/辛口）／「麻婆春雨」
- 李錦記「豆板醤」「オイスターソース」

### 和食
- キッコーマン「うちのごはん」: 豚バラなす／鶏の照り煮／なすのみぞれ炒め／甘辛とり丼／牛肉ごぼう／鶏ごぼうご飯の素／レンジでチンする肉じゃが
- エバラ「すき焼のたれ」「焼肉のたれ 黄金の味（甘口/中辛/辛口）」「プチッと鍋」シリーズ
- 永谷園「すし太郎」「松茸のお吸い物」（隠し味にも）「ちゃんこ鍋の素」
- 理研「わかめスープの素」／ヤマサ「昆布つゆ」「追いがつおつゆ」

### 洋食
- ハウス「シチューミクス クリーム/ビーフ」「ジャワカレー」「バーモントカレー」「めばえ」（子供向け甘口）
- S&B「ディナーカレー」「本挽きスパイス」「カレーの王子さま」
- キッコーマン「デルモンテ 完熟トマトのハヤシライスソース」
- ケンコー「ポテトサラダの素」／デルモンテ「基本のトマトソース」

### イタリアン
- S&B「予約でいっぱいの店の ボロネーゼ／カルボナーラ／ペペロンチーノ」
- キユーピー「あえるパスタソース」シリーズ
- マ・マー「オリーブオイル使用 ミートソース」

### 韓国
- モランボン「ジャン ビビンバの素／チャプチェ用／プルコギのたれ／ヤンニョムチキンの素」
- 李王家「石焼ビビンバの素」／エバラ「キムチ鍋の素」

### エスニック
- ヤマモリ「タイカレー」（グリーン/レッド/イエロー）／「ナシゴレンの素」
- S&B「菜館 青椒肉絲／麻婆豆腐」
- ユウキ食品「ガパオの素」

### ソース・タレ類
- オタフク「お好みソース」「焼きそばソース」「たこ焼ソース」
- キッコーマン「うちの献立」シリーズ「わが家は焼肉屋さん」
- ミツカン「味ぽん」「カンタン酢」「ぶっかけ（さしみ・いくら用）」「すし酢」
- 日本食研「焼肉のたれ 宮殿」／「ハンバーグのたれ」

### ルールの重要点
- 製品名は**メーカー名＋商品名＋味の種類**まで書く（例: 「味の素 Cook Do 麻婆豆腐用 中辛 (3〜4人前×1箱)」）
- ingredients 配列に**市販品1行＋肉/野菜などの食材数行**の形で記載
- steps には「Cook Do を加えて炒め合わせる」のように使用タイミングを明記
- 使える時短タイミング: 主菜の味付けが複雑な中華/韓国系・子供受け狙いの洋食ソース・夕食の一品追加
- 1日の献立で市販品を使うメニューは1〜2品に留める（全部市販品に偏らない）
- cookTimeMin を短縮できるメニューで優先的に採用。例: Cook Do で回鍋肉なら15分、うちのごはん豚バラなすなら10分` : `## 【市販の合わせ調味料】使用不可。全て基本調味料で味付けすること。`}

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

${p.days >= 7 ? `## 【1週間献立プランとしての構成・必須】
7日間は「1週間の家庭献立計画」として設計すること。以下を満たす:
- 主菜のタンパク源を週単位で分散: 鶏2回・豚2回・牛1回・魚2回 を目安にバランス良く配置
- 週末（土日）は少し手間をかけられる or 豪華な一品をOK（cookTimeMin を30分まで緩めて良い）
- 平日は15〜20分の時短メニューを基本にする
- 週半ばに「使い切り・リメイク」メニューを1品入れる（前半で余った食材の消費）
- 週の最初の1〜2日は日持ちしない食材（葉物野菜・刺身）、後半は冷凍可能食材（ひき肉・豚こま・鮭切り身）を配置
- 連日で同じ調理法（毎日炒め物など）にならないよう、「炒め / 煮 / 焼き / 蒸し / 揚げ焼き / 和え / 汁」をローテーションする
- 1週間の塩分・脂質が偏らないよう、こってり系の翌日はさっぱり系に振る
- 週1〜2回は「市販調味料活用」で負担を減らす（市販調味料OKの場合）
- notes に「鶏◯回/豚◯回/牛◯回/魚◯回、使い切り◯品、お気に入り再登場◯品」と内訳を書く` : ''}

## 【その他】
- 連日で主菜の主食材（肉/魚）が被らないこと。
- 各食事のカロリー・塩分バランスを家族の年齢に合わせて調整。子供向けに辛味は控えめに。
- notes に「新規◯品＋お気に入り再登場◯品」のように内訳を書く。

## 【スキーマ厳守】← 違反は自動再生成の対象。必ず守ること
- **days 配列は ${p.days} 個ちょうど**返す（${p.days} 個未満も超過もNG）。dayIndex は 0 から ${p.days - 1} まで連番で重複なし。
- **各 day.meals には「${mealList}」のキーのみ**を含める。${(p.mealTypes || ['dinner']).map(m => `\`${m}\``).join('、')} 以外のキー（${(['breakfast', 'lunch', 'dinner']).filter(k => !(p.mealTypes || []).includes(k)).map(k => `\`${k}\``).join('、') || 'なし'}）は**含めてはいけない**。
- ${(p.mealTypes || ['dinner']).map(m => `\`${m}\``).join('・')} はそれぞれ各日に**必ず1つずつ**生成する（欠落NG）。

# 出力前の自己チェック（必須）
出力前に以下を必ず確認：
1. days.length === ${p.days} か？
2. 各 day.meals のキー集合が [${(p.mealTypes || ['dinner']).map(m => `"${m}"`).join(', ')}] と完全一致するか？
3. dayIndex が 0〜${p.days - 1} の範囲で重複なしか？
全てYESになるまで内部で見直してから出力すること。

では、献立をJSONで生成してください。`;
}

// ------------ 結果検証 ------------
/**
 * Gemini レスポンスがユーザー指定通りか検証。違反があれば違反内容の文字列配列を返す（空配列＝合格）。
 */
function validateGeneratedResult(parsed, payload) {
  const violations = [];
  const expectedDays = Number(payload.days || 1);
  const expectedMealKeys = new Set(payload.mealTypes || ['dinner']);

  if (!parsed || !Array.isArray(parsed.days)) {
    violations.push('days 配列が存在しない');
    return violations;
  }

  if (parsed.days.length !== expectedDays) {
    violations.push(`days 長さが不一致: 指定=${expectedDays} / 実際=${parsed.days.length}`);
  }

  const seenIndex = new Set();
  parsed.days.forEach((day, i) => {
    const idx = day.dayIndex;
    if (typeof idx !== 'number') {
      violations.push(`days[${i}].dayIndex が数値でない`);
    } else if (seenIndex.has(idx)) {
      violations.push(`dayIndex=${idx} が重複`);
    } else {
      seenIndex.add(idx);
    }

    const meals = day.meals || {};
    const actualKeys = new Set(Object.keys(meals).filter(k => meals[k]));
    // 期待キーが全部揃っているか
    for (const k of expectedMealKeys) {
      if (!actualKeys.has(k)) {
        violations.push(`day=${idx} に必要な食事キー「${k}」が欠落`);
      }
    }
    // 期待外のキーが入っていないか
    for (const k of actualKeys) {
      if (!expectedMealKeys.has(k)) {
        violations.push(`day=${idx} に不要な食事キー「${k}」が混入`);
      }
    }
  });

  return violations;
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

  const basePrompt = buildPrompt(payload);

  // 試行ループ：通信失敗（HTTP/JSON）で2回、検証失敗で2回までフィードバック付き再生成（最大3往復）。
  const MAX_API_FAILS = 2;       // ネットワーク・JSON parse 等の失敗
  const MAX_VALIDATION_RETRY = 2; // バリデーション違反で再生成
  let lastError = null;
  let lastViolations = null;
  let apiFailCount = 0;
  let validationRetry = 0;
  let regenerationLog = [];

  while (true) {
    // フィードバック付きプロンプト（前回違反があれば追記）
    let prompt = basePrompt;
    if (lastViolations && lastViolations.length > 0) {
      prompt = basePrompt + `

# 【最重要】前回の出力にスキーマ違反がありました
前回の出力で以下の違反が検出され、自動的に再生成されています。**今回は絶対に厳守**してください：
${lastViolations.map(v => `- ${v}`).join('\n')}

特に以下を再確認してから出力してください：
- days 配列の長さは **${payload.days}** 個ちょうど
- 各 day.meals のキーは **${(payload.mealTypes || ['dinner']).join('・')}** のみ（それ以外含めない）
`;
    }

    const geminiBody = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: OUTPUT_SCHEMA,
        temperature: 0.65,        // 0.8→0.65 に下げて指示遵守強化
        maxOutputTokens: 16384,
      },
    };

    let parsed = null;
    try {
      const res = await fetch(GEMINI_ENDPOINT(apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      });
      if (!res.ok) {
        lastError = 'Gemini API ' + res.status + ': ' + (await res.text()).slice(0, 300);
      } else {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          lastError = 'Gemini レスポンスにテキストなし';
        } else {
          try { parsed = JSON.parse(text); }
          catch (e) { lastError = 'JSON parse 失敗: ' + e.message; }
        }
      }
    } catch (e) {
      lastError = String(e);
    }

    // 通信・パース失敗 → API失敗扱い
    if (!parsed) {
      apiFailCount++;
      if (apiFailCount >= MAX_API_FAILS) {
        return new Response('生成失敗: ' + lastError, { status: 502 });
      }
      continue;
    }

    // 検証
    const violations = validateGeneratedResult(parsed, payload);
    if (violations.length === 0) {
      // 合格。再生成があった場合は notes 末尾に記録
      if (regenerationLog.length > 0) {
        const tag = `\n[自動再生成 ${regenerationLog.length}回: ${regenerationLog.join(' / ')}]`;
        parsed.notes = (parsed.notes || '') + tag;
      }
      return new Response(JSON.stringify(parsed), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 検証失敗
    regenerationLog.push(violations.slice(0, 3).join('・'));
    if (validationRetry >= MAX_VALIDATION_RETRY) {
      // 上限到達。やむなく結果を返す（notesに違反内容を記録）
      const tag = `\n[警告: 検証違反が解消できませんでした: ${violations.join(' / ')}]`;
      parsed.notes = (parsed.notes || '') + tag;
      return new Response(JSON.stringify(parsed), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    validationRetry++;
    lastViolations = violations;
    // ループ継続でフィードバック付き再生成
  }
}
