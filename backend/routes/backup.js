// =============================================================
// backend/routes/backup.js — Copia de seguridad completa (solo admin)
//
// GET  /api/backup  → ciclos, usuarios y programaciones completas
// POST /api/backup  → restaura (fusiona por cod de ciclo y username)
// =============================================================
const express = require('express');
const db      = require('../db');
const { sanitizeDeep } = require('../sanitize');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAdmin, (req, res) => {
  const ciclos = db.prepare(`SELECT id, cod, nombre, locked_fields, created_at FROM ciclo_profiles`).all();
  const users  = db.prepare(`SELECT id, username, password_hash, role, ciclo_id, nombre, activo, created_at FROM users`).all();
  const progs  = db.prepare(`SELECT id, user_id, ciclo_id, titulo, codigo, data, created_at, updated_at FROM programaciones WHERE deleted_at IS NULL`).all();
  const userCiclos = db.prepare(`SELECT user_id, ciclo_id FROM user_ciclos`).all();
  db.audit(req, 'backup.exportar', null, null, { programaciones: progs.length });
  res.json({
    version: 3,
    exportDate: new Date().toISOString(),
    ciclos:         ciclos.map(c => ({ ...c, locked_fields: JSON.parse(c.locked_fields || '[]') })),
    users,
    user_ciclos: userCiclos,
    programaciones: progs.map(p => ({ ...p, data: JSON.parse(p.data || '{}') })),
  });
});

router.post('/', requireAdmin, (req, res) => {
  const { version, ciclos = [], users = [], programaciones = [] } = req.body || {};
  // Backups anteriores a la relación N:M: derivar de users.ciclo_id
  const userCiclos = req.body.user_ciclos
    || users.filter(u => u.ciclo_id).map(u => ({ user_id: u.id, ciclo_id: u.ciclo_id }));
  if (version !== 3) return res.status(400).json({ error: 'Formato de copia no soportado (se espera version 3).' });

  const stats = { ciclos: 0, users: 0, user_ciclos: 0, programaciones: 0 };
  const run = db.transaction(() => {
    // 1. Ciclos: upsert por cod
    const cicloMap = {};
    const findC = db.prepare(`SELECT id FROM ciclo_profiles WHERE cod = ?`);
    const insC  = db.prepare(`INSERT INTO ciclo_profiles (cod, nombre, locked_fields) VALUES (?, ?, ?)`);
    const updC  = db.prepare(`UPDATE ciclo_profiles SET nombre = ?, locked_fields = ? WHERE id = ?`);
    for (const c of ciclos) {
      const lf = JSON.stringify(sanitizeDeep(c.locked_fields || []));
      const ex = findC.get(c.cod);
      if (ex) { updC.run(c.nombre, lf, ex.id); cicloMap[c.id] = ex.id; }
      else    { cicloMap[c.id] = insC.run(c.cod, c.nombre, lf).lastInsertRowid; }
      stats.ciclos++;
    }

    // 2. Usuarios: upsert por username (conserva el hash → misma contraseña)
    const userMap = {};
    const findU = db.prepare(`SELECT id FROM users WHERE username = ?`);
    const insU  = db.prepare(`INSERT INTO users (username, password_hash, role, ciclo_id, nombre, activo) VALUES (?, ?, ?, ?, ?, ?)`);
    const updU  = db.prepare(`UPDATE users SET ciclo_id = ?, nombre = ?, activo = ? WHERE id = ?`);
    for (const u of users) {
      const ciclo = u.ciclo_id ? (cicloMap[u.ciclo_id] ?? null) : null;
      const ex = findU.get(u.username);
      if (ex) { if (u.role !== 'admin') updU.run(ciclo, u.nombre, u.activo ?? 1, ex.id); userMap[u.id] = ex.id; }
      else    { userMap[u.id] = insU.run(u.username, u.password_hash, u.role || 'docente', ciclo, u.nombre, u.activo ?? 1).lastInsertRowid; }
      stats.users++;
    }

    // 2b. Asignaciones docente ↔ ciclo (se añaden a las existentes)
    const insUC = db.prepare(`INSERT OR IGNORE INTO user_ciclos (user_id, ciclo_id) VALUES (?, ?)`);
    for (const r of userCiclos) {
      const uid = userMap[r.user_id], cid = cicloMap[r.ciclo_id];
      if (uid && cid) stats.user_ciclos += insUC.run(uid, cid).changes;
    }
    db.prepare(`
      UPDATE users SET ciclo_id = (SELECT MIN(ciclo_id) FROM user_ciclos WHERE user_id = users.id)
      WHERE ciclo_id IS NULL OR ciclo_id NOT IN (SELECT ciclo_id FROM user_ciclos WHERE user_id = users.id)
    `).run();

    // 3. Programaciones: se añaden (no se sobrescriben las existentes)
    const insP = db.prepare(`INSERT INTO programaciones (user_id, ciclo_id, titulo, codigo, data, created_at, updated_at)
                             VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`);
    for (const p of programaciones) {
      const uid = userMap[p.user_id] ?? req.user.id;
      const cid = p.ciclo_id ? (cicloMap[p.ciclo_id] ?? null) : null;
      insP.run(uid, cid, sanitizeDeep(p.titulo), p.codigo ? sanitizeDeep(p.codigo) : null, JSON.stringify(sanitizeDeep(p.data || {})), p.created_at, p.updated_at);
      stats.programaciones++;
    }
  });

  try { run(); db.audit(req, 'backup.restaurar', null, null, stats); res.json({ ok: true, stats }); }
  catch (e) { res.status(500).json({ error: 'Error restaurando: ' + e.message }); }
});

module.exports = router;
