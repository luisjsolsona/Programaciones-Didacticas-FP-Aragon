// =============================================================
// backend/routes/catedu.js — Proxy de lectura a CATEDU
//
// GET /api/catedu?url=<url de centrosdocentes.catedu.es>
//
// El navegador no puede leer centrosdocentes.catedu.es directamente
// (no envía cabeceras CORS). Antes se usaba una extensión del navegador
// o proxies públicos; ahora la petición la hace el backend.
// Solo se permiten URLs de ese dominio (evita usarlo como proxy abierto).
// =============================================================
const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_HOST = 'centrosdocentes.catedu.es';
const TIMEOUT_MS   = 15000;
const MAX_BYTES    = 5 * 1024 * 1024;
const CACHE_TTL    = 60 * 60 * 1000;   // 1 h
const cache = new Map();               // url → { t, html }

// Decodifica respetando el charset (CATEDU puede servir ISO-8859-1)
function decode(buf, contentType) {
  let charset = /charset=([^;]+)/i.exec(contentType || '')?.[1];
  if (!charset) {
    const head = Buffer.from(buf.slice(0, 4096)).toString('latin1');
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try { return new TextDecoder((charset || 'utf-8').trim().toLowerCase()).decode(buf); }
  catch { return new TextDecoder('utf-8').decode(buf); }
}

router.get('/', requireAuth, async (req, res) => {
  let url;
  try { url = new URL(String(req.query.url || '')); }
  catch { return res.status(400).json({ error: 'URL no válida.' }); }

  if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== ALLOWED_HOST) {
    return res.status(400).json({ error: `Solo se permiten URLs de ${ALLOWED_HOST}.` });
  }
  url.protocol = 'https:';
  const key = url.toString();

  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) {
    return res.type('text/html; charset=utf-8').send(hit.html);
  }

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(key, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (ProgramacionesFP; +https://programaciones.mistikedu.com)' },
    });
    // Tras redirecciones, seguir dentro del dominio permitido
    if (new URL(r.url).hostname !== ALLOWED_HOST) {
      return res.status(502).json({ error: 'CATEDU redirigió fuera de su dominio.' });
    }
    if (!r.ok) return res.status(502).json({ error: `CATEDU respondió ${r.status}.` });

    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return res.status(502).json({ error: 'Respuesta de CATEDU demasiado grande.' });

    const html = decode(buf, r.headers.get('content-type'));
    cache.set(key, { t: Date.now(), html });
    if (cache.size > 500) cache.delete(cache.keys().next().value);

    res.type('text/html; charset=utf-8').send(html);
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'CATEDU no respondió a tiempo.' : 'No se pudo conectar con CATEDU.';
    res.status(502).json({ error: msg });
  } finally {
    clearTimeout(tid);
  }
});

module.exports = router;
