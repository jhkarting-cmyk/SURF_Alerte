// Cloudflare Pages — Worker "advanced mode".
//
// Ce fichier DOIT s'appeler exactement "_worker.js" et rester à la racine du
// dossier déployé : c'est la seule convention Cloudflare Pages compatible à
// la fois avec le glisser-déposer du tableau de bord ET avec un déploiement
// via Wrangler (contrairement à un dossier functions/, qui ne fonctionne
// qu'avec Wrangler — voir la doc officielle : "drag and drop deployments
// made from the Cloudflare dashboard do not currently support compiling a
// functions folder [...] a _worker.js file is supported by both Wrangler
// and drag and drop deployments").
//
// Rôle : (1) laisser passer toutes les requêtes normales vers les fichiers
// statiques (index.html, manifest.json, sw.js, icons/...), (2) intercepter
// uniquement /api/candhis pour relayer les appels vers l'API CANDHIS en
// ajoutant la clé d'accès côté serveur — le navigateur ne la voit jamais.
//
// Configuration requise dans le tableau de bord Cloudflare Pages :
//   Settings > Environment variables > Add variable
//     Name  : CANDHIS_API_KEY
//     Value : (votre clé d'accès CANDHIS)
//     Type  : Secret (encrypted)
// Puis redéployer (ou "Retry deployment") pour que la variable soit prise en
// compte.

const ALLOWED_ENDPOINTS = new Set([
  "getCampListe.php",
  "getCampInfos.php",
  "getCampDispo.php",
  "getCampZone.php",
  "getCampTD.php",
  "getCampTR.php",
  "getCampListeTR.php",
]);

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

async function handleCandhisProxy(request, url, env) {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ success: false, message: "Méthode non autorisée." }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  const endpoint = url.searchParams.get("endpoint");
  if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) {
    return new Response(
      JSON.stringify({ success: false, message: "Endpoint CANDHIS inconnu ou non autorisé." }),
      { status: 400, headers: JSON_HEADERS }
    );
  }

  const apiKey = env.CANDHIS_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        success: false,
        message:
          "Clé CANDHIS non configurée côté serveur. Ajoutez la variable d'environnement " +
          "CANDHIS_API_KEY dans les réglages du projet Cloudflare Pages, puis redéployez.",
      }),
      { status: 500, headers: JSON_HEADERS }
    );
  }

  const upstream = new URL("https://candhis.cerema.fr/API/v1/" + endpoint);
  url.searchParams.forEach((value, key) => {
    if (key !== "endpoint") upstream.searchParams.set(key, value);
  });

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream.toString(), {
      headers: { Authorization: apiKey },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, message: "Impossible de joindre candhis.cerema.fr depuis le serveur relais." }),
      { status: 502, headers: JSON_HEADERS }
    );
  }

  const body = await upstreamRes.text();
  return new Response(body, { status: upstreamRes.status, headers: JSON_HEADERS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/candhis") {
      return handleCandhisProxy(request, url, env);
    }
    // Tout le reste : fichiers statiques déployés (index.html, manifest.json,
    // sw.js, icons/...), servis normalement.
    return env.ASSETS.fetch(request);
  },
};
