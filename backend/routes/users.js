// =============================================================
// backend/routes/users.js — Gestión de usuarios (docentes)
//
// Todas las rutas requieren autenticación.
// Las de creación/edición/borrado solo las puede usar el admin.
// Un docente puede cambiar su propia contraseña.
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

// =============================================================
// GET /api/users — Listar docentes (solo admin)
// Devuelve todos los usuarios con su ciclo asignado
// =============================================================
router.get('/', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.nombre, u.role, u.activo, u.created_at,
           u.ciclo_id, cp.cod AS cicloCod, cp.nombre AS cicloNombre
    FROM users u
    LEFT JOIN ciclo_profiles cp ON cp.id = u.ciclo_id
    ORDER BY u.role DESC, u.username ASC
  `).all();

  // Adjuntar todos los ciclos de cada usuario (N:M)
  const rel = db.prepare(`
    SELECT uc.user_id, cp.id, cp.cod, cp.nombre
    FROM user_ciclos uc JOIN ciclo_profiles cp ON cp.id = uc.ciclo_id
    ORDER BY cp.cod
  `).all();
  users.forEach(u => {
    u.ciclos   = rel.filter(r => r.user_id === u.id).map(({ id, cod, nombre }) => ({ id, cod, nombre }));
    u.cicloIds = u.ciclos.map(c => c.id);
  });

  res.json({ users });
});

// =============================================================
// POST /api/users — Crear docente (solo admin)
// Body: { username, password, nombre, cicloIds[] }  (cicloId legacy)
// =============================================================
router.post('/', requireAdmin, (req, res) => {
  const { username, password, nombre } = req.body;
  const cicloIds = db.parseCicloIds(req.body) || [];

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
  }

  // Verificar que el username no está en uso
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    return res.status(409).json({ error: 'El nombre de usuario ya existe.' });
  }

  // Verificar que los ciclos existen
  if (db.findMissingCiclo(cicloIds) !== null) {
    return res.status(400).json({ error: 'Alguno de los ciclos indicados no existe.' });
  }

  const hash = bcrypt.hashSync(password, 12);

  const result = db.prepare(`
    INSERT INTO users (username, password_hash, role, nombre)
    VALUES (?, ?, 'docente', ?)
  `).run(username, hash, nombre || null);

  db.setUserCiclos(result.lastInsertRowid, cicloIds);

  res.status(201).json({
    user: { id: result.lastInsertRowid, username, nombre, cicloIds }
  });
});

// =============================================================
// GET /api/users/:id — Ver un docente
// Admin puede ver cualquiera; docente solo puede verse a sí mismo
// =============================================================
router.get('/:id', requireAuth, (req, res) => {
  const targetId = parseInt(req.params.id);

  // Un docente solo puede ver su propio perfil
  if (req.user.role !== 'admin' && req.user.id !== targetId) {
    return res.status(403).json({ error: 'No tienes permiso para ver este usuario.' });
  }

  const user = db.prepare(`
    SELECT u.id, u.username, u.nombre, u.role, u.activo, u.created_at,
           u.ciclo_id, cp.cod AS cicloCod, cp.nombre AS cicloNombre
    FROM users u
    LEFT JOIN ciclo_profiles cp ON cp.id = u.ciclo_id
    WHERE u.id = ?
  `).get(targetId);

  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

  user.ciclos   = db.getUserCiclos(user.id);
  user.cicloIds = user.ciclos.map(c => c.id);
  res.json({ user });
});

// =============================================================
// PUT /api/users/:id — Editar docente (solo admin)
// Body: { nombre?, cicloIds?[], activo? }  (cicloId legacy)
// No permite cambiar contraseña (usar /password) ni username
// =============================================================
router.put('/:id', requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.id);
  const { nombre, activo } = req.body;
  const cicloIds = db.parseCicloIds(req.body); // undefined = no tocar

  // Leer datos actuales para no sobreescribir lo que no se manda
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (target.role === 'admin') {
    return res.status(403).json({ error: 'La cuenta admin no se puede modificar desde aquí.' });
  }

  // Verificar que los ciclos existen
  if (cicloIds && db.findMissingCiclo(cicloIds) !== null) {
    return res.status(400).json({ error: 'Alguno de los ciclos indicados no existe.' });
  }

  // Solo actualizar los campos recibidos; preservar los demás
  const newNombre = nombre  !== undefined ? (nombre || null)          : target.nombre;
  const newActivo = activo  !== undefined ? (activo ? 1 : 0)          : target.activo;

  db.prepare(`
    UPDATE users SET nombre = ?, activo = ? WHERE id = ?
  `).run(newNombre, newActivo, targetId);

  if (cicloIds) db.setUserCiclos(targetId, cicloIds);

  res.json({ ok: true });
});

// =============================================================
// DELETE /api/users/:id — Eliminar docente (solo admin)
// No permite eliminar la cuenta admin
// =============================================================
router.delete('/:id', requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.id);

  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (target.role === 'admin') {
    return res.status(403).json({ error: 'No se puede eliminar la cuenta admin.' });
  }

  // Al eliminar el usuario, sus programaciones se eliminan en cascada (FK CASCADE)
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

  // Si no es admin, debe verificar su contraseña actual
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
