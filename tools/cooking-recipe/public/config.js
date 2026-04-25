// 料理レシピ献立アプリ（PWA）設定
// ブラウザに配信されるので、APIキーなど秘匿情報は絶対に入れない。
// Gemini APIキーは Cloudflare Pages Functions の env.GEMINI_API_KEY で管理する。
window.COOKING_APP_CONFIG = {
  // 本番（Cloudflare Pages）にデプロイ後はこの相対URLで動く。ローカルでも wrangler pages dev 時に動作。
  GENERATE_URL: '/api/generate',
  DETECT_URL: '/api/detect-ingredients',
  // 開発者向け: 本番で既定の献立生成条件
  DEFAULTS: {
    days: 7,                    // 1週間の献立がデフォルト
    mealTypes: ['dinner'],      // 週間プランは夕食中心（朝昼を追加したい人は選択）
    maxCookTimeMin: 20,
    basicIngredientsOnly: true,
    batchShopping: true,        // 1週間→ため買い前提
    moodTag: 'normal',
    budgetYen: 1500,
    avoidMode: 'any',
  },
  // キャッシュ有効秒数（同一プロンプトを繰り返し送らない）
  CACHE_TTL_SEC: 60 * 60 * 24,
  // 画像1枚あたりの最大バイト数（Gemini Vision送信前に縮小）
  MAX_IMAGE_BYTES: 1_000_000, // 1MB
  MAX_IMAGE_EDGE_PX: 1280,
};
