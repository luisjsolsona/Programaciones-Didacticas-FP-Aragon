// =============================================================
// backend/routes/modules.js — Programaciones didácticas
//
// Reglas de acceso:
//   - Admin:   puede leer y editar TODAS las programaciones
//   - Docente: puede crear y editar sus PROPIAS programaciones
//             puede LEER (solo lectura) las del mismo ciclo
//
// Al leer una programación, se mezclan los campos bloqueados
// del perfil del ciclo con los datos guardados, para que el
// frontend siempre reciba los valores correctos de los campos
// que el admin ha fijado.
//
// Rutas:
//   GET    /api/modules          — Listar programaciones
//   POST   /api/modules          — Crear programación
//   GET    /api/modules/:id      — Obtener programación
//   PUT    /api/modules/:id      — Editar programación
//   DELETE /api/modules/:id      — Eliminar programación
// =============================================================

const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// -------------------------------------------------------------
// Helper: obtener los campos bloqueados de un ciclo
// Devuelve un objeto { key: value } para mezclar fácilmente
// con los datos de la programación
// -------------------------------------------------------------
function getLockedFields(cicloId) {
  if (!cicloId) return {};
  const profile = db.prepare(
    'SELECT locked_fields FROM ciclo_profiles WHERE id = ?'
  ).get(cicloId);
  if (!profile) return {};

  const fields = JSON.parse(profile.locked_fields || '[]');
  // Convertir array [{ key, value }] a objeto { key: value }
  return Object.fromEntries(fields.map(f => [f.key, f.value]));
}

// =============================================================
// GET /api/modules — Listar programaciones
//
// Admin: devuelve todas, con nombre del docente y ciclo
// Docente: devuelve las propias + las del mismo ciclo (solo lectura)
// =============================================================
router.get('/', requireAuth, (req, res) => {
  let rows;

  if (req.user.role === 'admin') {
    // Admin ve todo
    rows = db.prepare(`
      SELECT p.id, p.titulo, p.codigo, p.created_at, p.updated_at,
             p.user_id, p.ciclo_id,
             u.username, u.nombre AS docenteNombre,
             cp.cod AS cicloCod, cp.nombre AS cicloNombre
      FROM programaciones p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN ciclo_profiles cp ON cp.id = p.ciclo_id
      ORDER BY p.updated_at DESC
    `).all();
  } else {
    // Docente ve las propias + las de cualquiera de sus ciclos
    rows = db.prepare(`
      SELECT p.id, p.titulo, p.codigo, p.created_at, p.updated_at,
             p.user_id, p.ciclo_id,
             u.username, u.nombre AS docenteNombre,
             cp.cod AS cicloCod, cp.nombre AS cicloNombre,
             CASE WHEN p.user_id = ? THEN 1 ELSE 0 END AS is_own
      FROM programaciones p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN ciclo_profiles cp ON cp.id = p.ciclo_id
      WHERE p.user_id = ?
         OR p.ciclo_id IN (
              SELECT ciclo_id FROM user_ciclos WHERE user_id = ?
            )
      ORDER BY p.updated_at DESC
    `).all(req.user.id, req.user.id, req.user.id);
  }

  res.json({ modules: rows });
});

// =============================================================
// POST /api/modules — Crear programación
// Body: { titulo, codigo, data, cicloId? }
// Si no se indica cicloId, se usa el del usuario autenticado
// =============================================================
router.post('/', requireAuth, (req, res) => {
  const { titulo, codigo, data = {}, cicloId } = req.body;

  if (!titulo) {
    return res.status(400).json({ error: 'El título (nombre del módulo) es obligatorio.' });
  }

  // Usar el ciclo indicado, o el primero de los ciclos del docente
  const effectiveCicloId = cicloId || req.user.cicloIds[0] || null;

  // Aplicar campos sugeridos del ciclo como valores iniciales (el usuario puede cambiarlos)
  const lockedFields = getLockedFields(effectiveCicloId);
  const finalData    = { ...lockedFields, ...data };

  const result = db.prepare(`
    INSERT INTO programaciones (user_id, ciclo_id, titulo, codigo, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, effectiveCicloId, titulo, codigo || null, JSON.stringify(finalData));

  res.status(201).json({
    module: { id: result.lastInsertRowid, titulo, codigo, cicloId: effectiveCicloId }
  });
});

// =============================================================
// GET /api/modules/:id — Obtener una programación completa
//
// Permiso:
//   - Admin:           siempre
//   - Propietario:     siempre
//   - Mismo ciclo:     solo lectura (se indica en la respuesta)
// =============================================================
router.get('/:id', requireAuth, (req, res) => {
  const moduleId = parseInt(req.params.id);

  const row = db.prepare(`
    SELECT p.*, u.username, u.nombre AS docenteNombre,
           cp.cod AS cicloCod, cp.nombre AS cicloNombre,
           cp.locked_fields
    FROM programaciones p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN ciclo_profiles cp ON cp.id = p.ciclo_id
    WHERE p.id = ?
  `).get(moduleId);

  if (!row) return res.status(404).json({ error: 'Programación no encontrada.' });

  const isOwner   = row.user_id  === req.user.id;
  const isAdmin   = req.user.role === 'admin';
  const sameCiclo = row.ciclo_id && req.user.cicloIds.includes(row.ciclo_id);
  const readOnly  = !isOwner && !isAdmin;

  if (!isOwner && !isAdmin && !sameCiclo) {
    return res.status(403).json({ error: 'No tienes acceso a esta programación.' });
  }

  // Devolver los datos tal como los guardó el usuario (las sugerencias se aplican al crear)
  const lockedFields = getLockedFields(row.ciclo_id);
  const data         = JSON.parse(row.data || '{}');
  const lockedKeys   = Object.keys(lockedFields);

  res.json({
    module: {
      id:           row.id,
      titulo:       row.titulo,
      codigo:       row.codigo,
      cicloId:      row.ciclo_id,
      cicloCod:     row.cicloCod,
      cicloNombre:  row.cicloNombre,
      userId:       row.user_id,
      username:     row.username,
      docenteNombre: row.docenteNombre,
      created_at:   row.created_at,
      updated_at:   row.updated_at,
      data,
      lockedKeys,   // El frontend usa esto para saber qué campos son de solo lectura
      readOnly,     // true si el usuario solo puede ver, no editar
    }
  });
});

// =============================================================
// PUT /api/modules/:id — Editar programación
// Solo el propietario o el admin pueden editar
// Los campos bloqueados del ciclo se sobrescriben siempre
// =============================================================
router.put('/:id', requireAuth, (req, res) => {
  const moduleId = parseInt(req.params.id);
  const { titulo, codigo, data } = req.body;

  const row = db.prepare(
    'SELECT * FROM programaciones WHERE id = ?'
  ).get(moduleId);

  if (!row) return res.status(404).json({ error: 'Programación no encontrada.' });

  // Solo propietario o admin pueden editar
  if (row.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'No tienes permiso para editar esta programación.' });
  }

  // El usuario puede editar todos los campos, incluidos los que tenían texto sugerido
  const currentData  = JSON.parse(row.data || '{}');
  const finalData    = { ...currentData, ...(data || {}) };

  db.prepare(`
    UPDATE programaciones
    SET titulo = ?, codigo = ?, data = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    titulo ?? row.titulo,
    codigo ?? row.codigo,
    JSON.stringify(finalData),
    moduleId
  );

  res.json({ ok: true });
});

// =============================================================
// DELETE /api/modules/:id — Eliminar programación
// Solo el propietario o el admin pueden eliminar
// =============================================================
router.delete('/:id', requireAuth, (req, res) => {
  const moduleId = parseInt(req.params.id);

  const row = db.prepare(
    'SELECT user_id FROM programaciones WHERE id = ?'
  ).get(moduleId);

  if (!row) return res.status(404).json({ error: 'Programación no encontrada.' });

  if (row.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'No tienes permiso para eliminar esta programación.' });
  }

  db.prepare('DELETE FROM programaciones WHERE id = ?').run(moduleId);

  res.json({ ok: true });
});

module.exports = router;
