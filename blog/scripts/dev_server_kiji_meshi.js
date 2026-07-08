// 記事めしPWA ローカル検証用の簡易静的サーバー（開発検証専用・本番配信には使わない）
// 使い方: node blog/scripts/dev_server_kiji_meshi.js → http://localhost:8792
// 背景: このMacの preview_start サンドボックスでは python の http.server が
//       起動できない（PermissionError）ため node 版を常備する（2026-07-09）。
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'pwa-cloudflare');
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
};
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8792, () => console.log('[kiji-meshi] http://localhost:8792'));
