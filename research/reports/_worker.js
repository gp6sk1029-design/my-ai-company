// libe-matome 全体にパスワード（Basic認証）をかける Pages 上級モード Worker。
// パスワードはコードに書かず Cloudflare の秘密設定 env.SITE_PASSWORD から読む。
// 未設定の間は 503 を返し中身を見せない（=非公開・安全側）。
export default {
  async fetch(request, env) {
    const expected = env.SITE_PASSWORD;

    // パスワード未設定 → ロック（中身を見せない）
    if (!expected) {
      return new Response(
        "このサイトはまだパスワード未設定のため非公開です（管理者の設定待ち）。",
        { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    const header = request.headers.get("Authorization") || "";
    if (header.startsWith("Basic ")) {
      let pass = "";
      try {
        const decoded = atob(header.slice(6));
        pass = decoded.slice(decoded.indexOf(":") + 1);
      } catch (_) {}
      if (pass.length === expected.length && pass === expected) {
        // 認証OK → 静的ファイル（ポータル・各ビューア）を返す
        return env.ASSETS.fetch(request);
      }
    }

    // 未認証 → ブラウザのログインダイアログを出す
    return new Response("ログインが必要です。", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="libe-matome", charset="UTF-8"',
        "content-type": "text/plain; charset=utf-8",
      },
    });
  },
};
