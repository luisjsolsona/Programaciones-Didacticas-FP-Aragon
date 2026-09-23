// =============================================================
// backend/routes/reset.js — Borrado masivo (solo admin)
//
// POST /api/admin/reset
// Body: {
//   password: contraseña del admin (se vuelve a pedir),
//   confirm:  'BORRAR TODO' (texto exacto),
//   scope: { programaciones, docentes, ciclos, auditoria }  (booleanos)
// }
// Antes de borrar se guarda una copia completa de la BD en
// data/backups/pre-borrado-<fecha>.sqlite para poder deshacerlo.
// La cuenta admin nunca se borra.
// =============================================================
const express = require('express');
const bcrypt  = require('bcryptjs');
const fs      = require('fs');
const db      = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
const CONFIRM_TEXT = 'BORRAR TODO';

router.post('/', requireAdmin, (req, res) => {
  const { password, confirm, scope = {} } = req.body || {};
  const s = {
    programaciones: !!scope.programaciones,
    docentes:       !!scope.docentes,
    ciclos:         !!scope.ciclos,
    auditoria:      !!scope.auditoria,
  };
  if (!Object.values(s).some(Boolean)) {
    return res.status(400).json({ error: 'No has marcado nada para borrar.' });
  }
  if (confirm !== CONFIRM_TEXT) {
    return res.status(400).json({ error: `Escribe exactamente «${CONFIRM_TEXT}» para confirmar.` });
  }
  const admin = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!password || !admin || !bcrypt.compareSync(password, admin.password_hash)) {
    db.audit(req, 'admin.borrado_rechazado', null, null, 'contraseña incorrecta');
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }

  // Copia completa previa (permite deshacer restaurando el fichero)
  const dir = '/app/data/backups';
  fs.mkdirSync(dir, { recursive: true });
  const stamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = `${dir}/pre-borrado-${stamp}.sqlite`;
  try { db.exec(`VACUUM INTO '${backup}'`); }
  catch (e) { return res.status(500).json({ error: 'No se pudo crear la copia previa; no se ha borrado nada.' }); }

  const counts = {};
  db.transaction(() => {
    if (s.programaciones) {
      // Incluye papelera; el historial se borra en cascada
      counts.programaciones = db.prepare('DELETE FROM programaciones').run().changes;
    }
    if (s.docentes) {
      // Sus programaciones y asignaciones de ciclo se borran en cascada
      counts.docentes = db.prepare(`DELETE FROM users WHERE role <> 'admin'`).run().changes;
    }
    if (s.ciclos) {
      counts.ciclos = db.prepare('DELETE FROM ciclo_profiles').run().changes;
      db.prepare('UPDATE users SET ciclo_id = NULL').run();
    }
    if (s.auditoria) {
      counts.auditoria = db.prepare('DELETE FROM audit_log').run().changes;
    }
  })();

  // Se registra siempre, también si se ha vaciado la auditoría
  db.audit(req, 'admin.borrar_todo', null, null, { ...counts, copia: backup.split('/').pop() });
  console.log(`[Admin] Borrado masivo por usuario ${req.user.id}:`, counts, '· copia previa:', backup);

  res.json({ ok: true, counts, backup: backup.split('/').pop() });
});

module.exports = router;
