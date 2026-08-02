// Cloudflare Accessで保護した画面をオフライン保存しないため、通信は常にネットワークへ渡す。
// このService WorkerはスマホのPWA起動管理だけを担当する。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
