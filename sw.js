// Service worker — Alerte Vagues CANDHIS
// Rôles : (1) cache de l'app shell pour un chargement rapide/offline,
//         (2) vérification périodique best-effort des seuils de houle
//             via Periodic Background Sync (quand le navigateur le permet),
//         (3) affichage des notifications locales.

const CACHE_NAME = "candhis-shell-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// Même relais sécurisé que la page (voir functions/api/candhis.js) : le
// service worker n'a jamais besoin de la clé, il appelle la même origine.
const PROXY_BASE = "./api/candhis";
const DB_NAME = "candhis-app";
const DB_STORE = "kv";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Ne jamais mettre en cache les appels API (données live) : réseau uniquement.
  if (url.pathname.startsWith("/api/") || url.hostname.includes("open-meteo.com")) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// ---- Petit helper IndexedDB (miroir des réglages écrits par la page) ----
function idbGet(key) {
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(DB_STORE, "readonly");
      const getReq = tx.objectStore(DB_STORE).get(key);
      getReq.onsuccess = () => resolve(getReq.result);
      getReq.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}

function pickField(entete, row, regex) {
  const idx = entete.findIndex((h) => regex.test(h));
  if (idx === -1) return null;
  const v = parseFloat(row[idx]);
  return Number.isFinite(v) ? v : null;
}

async function checkThresholdsAndNotify() {
  const favorites = (await idbGet("favorites")) || [];
  if (favorites.length === 0) return;

  const byType = {};
  favorites.forEach((f) => {
    (byType[f.type] = byType[f.type] || []).push(f);
  });

  for (const type of Object.keys(byType)) {
    const spots = byType[type];
    const camps = spots.map((s) => s.camp).join(",");
    const url = `${PROXY_BASE}?endpoint=getCampListeTR.php&type=${type}&camp=${camps}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!data.success || !data.results) continue;
      const entete = data.entete;
      const campIdx = entete.indexOf("Campagne");
      for (const row of data.results) {
        const camp = row[campIdx];
        const spot = spots.find((s) => s.camp === camp);
        if (!spot) continue;
        const height = pickField(entete, row, /^(H1\/3|Hm0)/);
        if (height === null) continue;
        const threshold = spot.threshold || 1.5;
        if (height >= threshold) {
          await self.registration.showNotification("Alerte houle 🌊", {
            body: `${spot.nom} : ${height.toFixed(2)} m (seuil ${threshold} m)`,
            icon: "./icons/icon-192.png",
            badge: "./icons/icon-192.png",
            tag: "candhis-" + camp,
            data: { camp },
          });
        }
      }
    } catch (e) {
      // silencieux : pas de réseau ou CORS, on retentera au prochain cycle
    }
  }
}

// Périodique, best-effort (dépend du support navigateur + engagement utilisateur)
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "check-waves") {
    event.waitUntil(checkThresholdsAndNotify());
  }
});

// Message manuel depuis la page (ex: bouton "Vérifier maintenant")
self.addEventListener("message", (event) => {
  if (event.data === "check-waves-now") {
    event.waitUntil ? event.waitUntil(checkThresholdsAndNotify()) : checkThresholdsAndNotify();
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow("./index.html");
    })
  );
});
