// =============================================================
// backend/routes/users.js — Gestión de usuarios (docentes)
//
// Todas las rutas requieren autenticación.
// Las de creación/edición/borrado solo las puede usar el admin.
// Un docente puede cambiar su propia contraseña.
//
// Los ciclos de un usuario se almacenan en la tabla user_ciclos
// (relación muchos-a-muchos). El campo cicloIds del body es un
// array de IDs de ciclo_profiles.
//
// Rutas:
//   GET    /api/users              — Listar todos los docentes
//   POST   /api/users              — Crear docente (admin)
//   GET    /api/users/:id          — Ver un docente
//   PUT    /api/users/:id          — Editar docente (admin)
//   DELETE /api/users/:id          — Eliminar docente (admin)
//   PUT    /api/users/:id/password — Cambiar contraseña (propio o admin)
// =============================================================

const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// -------------------------------------------------------------
// Helper: devuelve los ciclos asignados a un usuario
// -------------------------------------------------------------
function getUserCiclos(userId) {
  return db.prepare(`
    SELECT cp.id, cp.cod, cp.nombre
    FROM user_ciclos uc
    JOIN ciclo_profiles cp ON cp.id = uc.ciclo_id
    WHERE uc.user_id = ?
    ORDER BY cp.nombre ASC
  `).all(userId);
}

// -------------------------------------------------------------
// Helper: reemplaza todos los ciclos de un usuario
// Recibe un array de cicloIds (puede estar vacío)
// -------------------------------------------------------------
function setUserCiclos(userId, cicloIds) {
  db.prepare('DELETE FROM user_ciclos WHERE user_id = ?').run(userId);
  if (!cicloIds || cicloIds.length === 0) return;

  const insert = db.prepare(
    'INSERT OR IGNORE INTO user_ciclos (user_id, ciclo_id) VALUES (?, ?)'
  );
  const insertMany = db.transaction((ids) => {
    for (const cid of ids) insert.run(userId, cid);
  });
  insertMany(cicloIds);
}

// =============================================================
// GET /api/users — Listar docentes (solo admin)
// =============================================================
router.get('/', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, nombre, role, activo, created_at
    FROM users
    ORDER BY role DESC, username ASC
  `).all();

  const result = users.map(u => ({ ...u, ciclos: getUserCiclos(u.id) }));
  res.json({ users: result });
});

// =============================================================
// POST /api/users — Crear docente (solo admin)
// Body: { username, password, nombre, cicloIds }
// cicloIds: array de IDs de ciclo (opcional)
// =============================================================
router.post('/', requireAdmin, (req, res) => {
  const { username, password, nombre, cicloIds = [] } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    return res.status(409).json({ error: 'El nombre de usuario ya existe.' });
  }

  // Validar que todos los ciclos existen
  const ids = Array.isArray(cicloIds) ? cicloIds.map(Number).filter(Boolean) : [];
  for (const cid of ids) {
    const ciclo = db.prepare('SELECT id FROM ciclo_profiles WHERE id = ?').get(cid);
    if (!ciclo) {
      return res.status(400).json({ error: `El ciclo con id ${cid} no existe.` });
    }
  }

  const hash   = bcrypt.hashSync(password, 12);
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, role, nombre)
    VALUES (?, ?, 'docente', ?)
  `).run(username, hash, nombre || null);

  const newId = result.lastInsertRowid;
  setUserCiclos(newId, ids);

  res.status(201).json({
    user: { id: newId, username, nombre, ciclos: getUserCiclos(newId) }
  });
});

// =============================================================
// GET /api/users/:id — Ver un docente
// Admin puede ver cualquiera; docente solo puede verse a sí mismo
// =============================================================
router.get('/:id', requireAuth, (req, res) => {
  const targetId = parseInt(req.params.id);

  if (req.user.role !== 'admin' && req.user.id !== targetId) {
    return res.status(403).json({ error: 'No tienes permiso para ver este usuario.' });
  }

  const user = db.prepare(`
    SELECT id, username, nombre, role, activo, created_at
    FROM users WHERE id = ?
  `).get(targetId);

  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

  res.json({ user: { ...user, ciclos: getUserCiclos(targetId) } });
});

// =============================================================
// PUT /api/users/:id — Editar docente (solo admin)
// Body: { nombre?, cicloIds?, activo? }
// cicloIds reemplaza la asignación completa de ciclos del usuario
// =============================================================
router.put('/:id', requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.id);
  const { nombre, cicloIds, activo } = req.body;

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (target.role === 'admin') {
    return res.status(403).json({ error: 'La cuenta admin no se puede modificar desde aquí.' });
  }

  // Validar ciclos si se proporcionan
  if (cicloIds !== undefined) {
    const ids = Array.isArray(cicloIds) ? cicloIds.map(Number).filter(Boolean) : [];
    for (const cid of ids) {
      const ciclo = db.prepare('SELECT id FROM ciclo_profiles WHERE id = ?').get(cid);
      if (!ciclo) return res.status(400).json({ error: `El ciclo con id ${cid} no existe.` });
    }
  }

  const newNombre = nombre  !== undefined ? (nombre || null)   : target.nombre;
  const newActivo = activo  !== undefined ? (activo ? 1 : 0)   : target.activo;

  db.prepare(`
    UPDATE users SET nombre = ?, activo = ? WHERE id = ?
  `).run(newNombre, newActivo, targetId);

  if (cicloIds !== undefined) {
    const ids = Array.isArray(cicloIds) ? cicloIds.map(Number).filter(Boolean) : [];
    setUserCiclos(targetId, ids);
  }

  res.json({ ok: true });
});

// =============================================================
// DELETE /api/users/:id — Eliminar docente (solo admin)
// =============================================================
router.delete('/:id', requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.id);

  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (target.role === 'admin') {
    return res.status(403).json({ error: 'No se puede eliminar la cuenta admin.' });
  }

  // user_ciclos se elimina en cascada por FK ON DELETE CASCADE
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

  res.json({ ok: true });
});

// =============================================================
// PUT /api/users/:id/password — Cambiar contraseña
// Admin puede cambiar la de cualquier docente.
// Un docente puede cambiar la suya si aporta la contraseña actual.
// Body: { currentPassword?, newPassword }
// =============================================================
router.put('/:id/password', requireAuth, (req, res) => {
  const targetId = parseInt(req.params.id);
  const { currentPassword, newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
  }

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });

  if (req.user.role !== 'admin') {
    if (req.user.id !== targetId) {
      return res.status(403).json({ error: 'No tienes permiso para cambiar esta contraseña.' });
    }
    if (!currentPassword || !bcrypt.compareSync(currentPassword, target.password_hash)) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
    }
  }

  const newHash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, targetId);

  res.json({ ok: true });
});

module.exports = router;
