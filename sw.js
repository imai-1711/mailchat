// MailChat Service Worker
const CACHE = 'mailchat-v5';
const ASSETS = ['./manifest.json'];

// インストール: manifest だけプリキャッシュ（index.html は network-first のためプリキャッシュしない）
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// アクティブ化: 古いキャッシュを削除
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// フェッチ戦略:
//   index.html / ルート → Network-first（常に最新を取得、失敗時のみキャッシュ）
//   n8n / Anthropic API → ネットワークのみ（キャッシュ不可）
//   その他静的アセット  → キャッシュ優先（ネットワーク更新後はキャッシュ上書き）
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API はキャッシュしない
  if (url.hostname.includes('n8n') || url.hostname.includes('anthropic')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // index.html / ルートは Network-first（開発中の変更を即反映）
  const isHtml = url.pathname === '/' || url.pathname.endsWith('.html');
  if (isHtml) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            // 最新版をキャッシュに保存（オフライン用）
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  // その他の静的アセットはキャッシュ優先
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

// プッシュ通知（将来の拡張用）
self.addEventListener('push', e => {
  if (!e.data) return;
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title || 'MailChat', {
      body: data.body || '新着メールがあります',
      icon: './manifest.json',
      badge: './manifest.json',
      tag: 'mailchat-notification',
      renotify: true,
    })
  );
});
