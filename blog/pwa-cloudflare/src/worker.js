const textEncoder = new TextEncoder();
let cachedJwks = null;
let cachedJwksAt = 0;

export default {
  async fetch(request, env) {
    const access = await verifyAccess(request, env);
    if (!access.ok) {
      return new Response(access.message, {
        status: access.status,
        headers: securityHeaders({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }),
      });
    }

    const url = new URL(request.url);
    if (url.pathname === '/api/gas') return proxyGas(request, env);
    if (isPrivateAssetPath(url.pathname)) {
      return new Response('Not Found', {
        status: 404,
        headers: securityHeaders({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }),
      });
    }
    return env.ASSETS.fetch(request);
  },
};

function isPrivateAssetPath(pathname) {
  return pathname.startsWith('/.')
    || pathname === '/wrangler.jsonc'
    || pathname === '/README.md'
    || pathname === '/src'
    || pathname.startsWith('/src/');
}

async function verifyAccess(request, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return { ok: false, status: 503, message: 'Cloudflare Accessの設定が完了していません。' };
  }

  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return { ok: false, status: 401, message: 'Cloudflare Accessでログインしてください。' };

  try {
    const payload = await validateJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
    return { ok: true, payload };
  } catch (error) {
    console.warn('Access JWT validation failed:', error instanceof Error ? error.message : 'unknown');
    return { ok: false, status: 401, message: 'Cloudflare Accessの認証を確認できませんでした。' };
  }
}

async function validateJwt(token, teamDomain, expectedAud) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('JWT形式が不正です');

  const header = JSON.parse(decodeBase64UrlText(parts[0]));
  const payload = JSON.parse(decodeBase64UrlText(parts[1]));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('JWT署名方式が不正です');

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) throw new Error('JWTの有効期限が切れています');
  if (payload.nbf && payload.nbf > now + 60) throw new Error('JWTはまだ有効ではありません');

  const normalizedTeamDomain = String(teamDomain).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const expectedIssuer = `https://${normalizedTeamDomain}`;
  if (payload.iss !== expectedIssuer) throw new Error('JWT発行元が一致しません');

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(expectedAud)) throw new Error('JWT対象が一致しません');

  const jwks = await getJwks(normalizedTeamDomain);
  const jwk = jwks.keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error('JWT公開鍵が見つかりません');

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeBase64UrlBytes(parts[2]),
    textEncoder.encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new Error('JWT署名が一致しません');
  return payload;
}

async function getJwks(teamDomain) {
  const now = Date.now();
  if (cachedJwks && now - cachedJwksAt < 60 * 60 * 1000) return cachedJwks;

  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access公開鍵の取得に失敗しました (${response.status})`);
  cachedJwks = await response.json();
  cachedJwksAt = now;
  return cachedJwks;
}

async function proxyGas(request, env) {
  if (!env.GAS_URL || !env.GAS_SHARED_TOKEN) {
    return json({ ok: false, error: 'サーバー接続設定が不足しています' }, 503);
  }
  if (!['GET', 'POST'].includes(request.method)) {
    return json({ ok: false, error: '許可されていない通信方法です' }, 405);
  }

  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(env.GAS_URL);
  sourceUrl.searchParams.forEach((value, key) => {
    if (key !== 'token') targetUrl.searchParams.append(key, value);
  });
  targetUrl.searchParams.set('token', env.GAS_SHARED_TOKEN);

  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  let body;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (contentType && contentType.includes('application/json')) {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ ok: false, error: 'JSON形式が不正です' }, 400);
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return json({ ok: false, error: 'JSONオブジェクトを送信してください' }, 400);
      }
      payload.token = env.GAS_SHARED_TOKEN;
      body = JSON.stringify(payload);
      headers.set('content-type', 'application/json');
    } else {
      body = await request.arrayBuffer();
    }
  }

  const response = await fetch(targetUrl, { method: request.method, headers, body, redirect: 'follow' });
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('set-cookie');
  responseHeaders.set('cache-control', 'no-store');
  Object.entries(securityHeaders()).forEach(([key, value]) => responseHeaders.set(key, value));
  return new Response(response.body, { status: response.status, headers: responseHeaders });
}

function securityHeaders(extra = {}) {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    ...extra,
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: securityHeaders({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }),
  });
}

function decodeBase64UrlText(value) {
  return new TextDecoder().decode(decodeBase64UrlBytes(value));
}

function decodeBase64UrlBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
