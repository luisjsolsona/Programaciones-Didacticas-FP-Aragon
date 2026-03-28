// =============================================================
// backend/routes/profiles.js — Perfiles de ciclo formativo
//
// Un perfil de ciclo define:
//   - El código y nombre del ciclo (ej: IFC201, SMR)
//   - Los campos que están bloqueados para los docentes de ese ciclo
//     y el valor fijo que tendrán esos campos
//
// locked_fields es un array JSON con la forma:
//   [
//     { key: "decreto_estatal", value: "RD 1691/2007...", label: "RD Título" },
//     { key: "decreto_aragon",  value: "ORDEN ECD/842/2024...", label: "Normativa Aragón" }
//   ]
//
// Rutas:
//   GET    /api/profiles         — Listar perfiles (cualquier usuario auth)
//   POST   /api/profiles         — Crear perfil (solo admin)
//   GET    /api/profiles/:id     — Ver perfil con campos bloqueados
//   PUT    /api/profiles/:id     — Editar perfil (solo admin)
//   DELETE /api/profiles/:id     — Eliminar perfil (solo admin)
// =============================================================

const express = require('express');
const db      = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// =============================================================
// GET /api/profiles — Listar todos los perfiles
// Disponible para cualquier usuario autenticado (docentes lo
// necesitan para ver los campos bloqueados de su ciclo)
// =============================================================
router.get('/', requireAuth, (req, res) => {
  const profiles = db.prepare(`
    SELECT id, cod, nombre, locked_fields, created_at
    FROM ciclo_profiles
    ORDER BY nombre ASC
  `).all();

  // Parsear locked_fields de JSON string a objeto
  const parsed = profiles.map(p => ({
    ...p,
    locked_fields: JSON.parse(p.locked_fields || '[]')
  }));

  res.json({ profiles: parsed });
});

// =============================================================
// POST /api/profiles — Crear perfil de ciclo (solo admin)
// Body: { cod, nombre, locked_fields }
// =============================================================
router.post('/', requireAdmin, (req, res) => {
  const { cod, nombre, locked_fields = [] } = req.body;

  if (!cod || !nombre) {
    return res.status(400).json({ error: 'El código y el nombre del ciclo son obligatorios.' });
  }

  // Verificar que el código no está duplicado
  const exists = db.prepare('SELECT id FROM ciclo_profiles WHERE cod = ?').get(cod);
  if (exists) {
    return res.status(409).json({ error: `Ya existe un perfil con el código ${cod}.` });
  }

  // Validar que locked_fields es un array válido
  if (!Array.isArray(locked_fields)) {
    return res.status(400).json({ error: 'locked_fields debe ser un array.' });
  }

  const result = db.prepare(`
    INSERT INTO ciclo_profiles (cod, nombre, locked_fields)
    VALUES (?, ?, ?)
  `).run(cod, nombre, JSON.stringify(locked_fields));

  res.status(201).json({
    profile: { id: result.lastInsertRowid, cod, nombre, locked_fields }
  });
});

// =============================================================
// GET /api/profiles/:id — Ver un perfil con todos sus campos
// =============================================================
router.get('/:id', requireAuth, (req, res) => {
  const profile = db.prepare(`
    SELECT id, cod, nombre, locked_fields, created_at
    FROM ciclo_profiles WHERE id = ?
  `).get(parseInt(req.params.id));

  if (!profile) return res.status(404).json({ error: 'Perfil no encontrado.' });

  res.json({
    profile: {
      ...profile,
      locked_fields: JSON.parse(profile.locked_fields || '[]')
    }
  });
});

// =============================================================
// PUT /api/profiles/:id — Editar perfil (solo admin)
// Body: { nombre?, locked_fields? }
// El código (cod) no se puede cambiar una vez creado
// =============================================================
router.put('/:id', requireAdmin, (req, res) => {
  const profileId = parseInt(req.params.id);
  const { nombre, locked_fields } = req.body;

  const existing = db.prepare('SELECT * FROM ciclo_profiles WHERE id = ?').get(profileId);
  if (!existing) return res.status(404).json({ error: 'Perfil no encontrado.' });

  // Validar locked_fields si se proporciona
  if (locked_fields !== undefined && !Array.isArray(locked_fields)) {
    return res.status(400).json({ error: 'locked_fields debe ser un array.' });
  }

  db.prepare(`
    UPDATE ciclo_profiles
    SET nombre = ?, locked_fields = ?
    WHERE id = ?
  `).run(
    nombre        ?? existing.nombre,
    locked_fields !== undefined
      ? JSON.stringify(locked_fields)
      : existing.locked_fields,
    profileId
  );

  res.json({ ok: true });
});

// =============================================================
// DELETE /api/profiles/:id — Eliminar perfil (solo admin)
// Pone ciclo_id a NULL en los usuarios y programaciones asociados
// (por la FK ON DELETE SET NULL definida en db.js)
// =============================================================
router.delete('/:id', requireAdmin, (req, res) => {
  const profileId = parseInt(req.params.id);

  const existing = db.prepare('SELECT id FROM ciclo_profiles WHERE id = ?').get(profileId);
  if (!existing) return res.status(404).json({ error: 'Perfil no encontrado.' });

  // Contar cuántos usuarios y programaciones se verán afectados
  const affectedUsers = db.prepare(
    'SELECT COUNT(*) as n FROM users WHERE ciclo_id = ?'
  ).get(profileId).n;

  const affectedProgs = db.prepare(
    'SELECT COUNT(*) as n FROM programaciones WHERE ciclo_id = ?'
  ).get(profileId).n;

  db.prepare('DELETE FROM ciclo_profiles WHERE id = ?').run(profileId);

  res.json({
    ok: true,
    info: `Perfil eliminado. ${affectedUsers} usuarios y ${affectedProgs} programaciones quedaron sin ciclo asignado.`
  });
});

module.exports = router;
