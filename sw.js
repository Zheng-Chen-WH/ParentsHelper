/* Service Worker：静态资源缓存，API 请求不拦截 */
const CACHE = 'kj-assistant-v48';
const CORE = [
  '.',
  'index.html',
  'style.css',
  'app.js',
  'providers.js',
  'agent.js',
  'sandbox.js',
  'jssandbox.js',
  'pyworker.js',
  'vendor/qrcode.js',
  'vendor/jsQR.js',
  'vendor/echarts.min.js',
  'vendor/pdf.min.js',
  'vendor/pdf.worker.min.js',
  'vendor/mammoth.min.js',
  'vendor/xlsx.full.min.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 只处理本站 GET；API 请求（跨域）直接放行
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // 页面和代码文件（html/js/css，体积小、更新频繁）：网络优先，发版后开一次就是新版；断网回退缓存
  if (e.request.mode === 'navigate' || /\.(js|css)$/.test(url.pathname)) {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html')))
    );
    return;
  }

  // 大文件（pyodide 运行时、图标、第三方库）：缓存优先，一次下载永久复用
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((resp) => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return resp;
      });
    })
  );
});
