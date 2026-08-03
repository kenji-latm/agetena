// オフライン用キャッシュ（http(s)配信時のみ有効）。Phase 2bで通知(push)処理を追加予定。
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const IS_AGETENA_PATH = /\/agetena\/$/.test(SCOPE_PATH);
const CACHE_PREFIX = IS_AGETENA_PATH ? "agetena-touki-kanryo-" : "touki-kanryo-root-";
const CACHE = `${CACHE_PREFIX}v36-v137`;
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=20260803-v137",
  "./app.js?v=20260803-v137",
  "./shared-config.js?v=20260803-v137",
  "./data/kanryo-integrity.js",
  "./data/kanryo.js",
  "./data/kanryo.json",
  "./manifest.webmanifest?v=20260710-agetena",
  "./apple-touch-icon.png?v=20260719-v112",
  "./icon-192.png?v=20260710-letterpack-after-due",
  "./icon-512.png?v=20260710-letterpack-after-due",
  "./icon.svg?v=20260719-v112",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => {
            if (k === CACHE) return false;
            if (k.startsWith(CACHE_PREFIX)) return true;
            return !IS_AGETENA_PATH && /^touki-kanryo-v/.test(k);
          })
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const isData = /\/data\/kanryo(?:-integrity)?\.(json|js)$/.test(url.pathname);
  const isPage = e.request.mode === "navigate";

  // 最新データはネットワーク優先。失敗時は最後にキャッシュできたデータへ戻る。
  if (isData) {
    const cacheKey = new Request(`${url.origin}${url.pathname}`);
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(cacheKey, res.clone()));
          return res;
        })
        .catch(() => caches.match(cacheKey))
    );
    return;
  }

  if (isPage) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
