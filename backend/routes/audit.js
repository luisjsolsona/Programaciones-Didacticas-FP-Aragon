// =============================================================
// backend/routes/audit.js — Registro de auditoría (solo admin)
//
// GET /api/audit?limit=100&before=<id>&q=<texto>
//   Devuelve las entradas más recientes. "before" pagina hacia atrás.
//   "q" filtra por usuario, acción o detalle.
// =============================================================
const express = require('express');
const db      = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAdmin, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 100, 500);
  const before = parseInt(req.query.before) || null;
  const q      = String(req.query.q || '').trim();

  const where = [], args = [];
  if (before) { where.push('id < ?'); args.push(before); }
  if (q) {
    where.push('(username LIKE ? OR action LIKE ? OR detail LIKE ? OR ip LIKE ?)');
    const like = `%${q}%`; args.push(like, like, like, like);
  }
  const rows = db.prepare(`
    SELECT id, at, user_id, username, action, target_type, target_id, detail, ip
    FROM audit_log
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id DESC LIMIT ?
  `).all(...args, limit);

  res.json({ entries: rows, hasMore: rows.length === limit });
});

module.exports = router;
