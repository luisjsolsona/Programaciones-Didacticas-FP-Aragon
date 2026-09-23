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
const { sanitizeDeep, cleanString } = require('../sanitize');
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
// Docente: devuelve las propias + las de cualquiera de sus ciclos (solo lectura)
// =============================================================
router.get('/', requireAuth, (req, res) => {
  let rows;

  if (req.user.role === 'admin') {
    // Admin ve todo
    rows = db.prepare(`
      SELECT p.id, p.titulo, p.codigo, p.created_at, p.updated_at, p.version, p.estado, p.estado_at,
             p.user_id, p.ciclo_id,
             u.username, u.nombre AS docenteNombre,
             cp.cod AS cicloCod, cp.nombre AS cicloNombre
      FROM programaciones p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN ciclo_profiles cp ON cp.id = p.ciclo_id
      WHERE p.deleted_at IS NULL
      ORDER BY p.updated_at DESC
    `).all();
  } else {
    // Docente ve las propias + las del mismo ciclo (sin datos, solo metadatos)
    rows = db.prepare(`
      SELECT p.id, p.titulo, p.codigo, p.created_at, p.updated_at, p.version, p.estado, p.estado_at,
             p.user_id, p.ciclo_id,
             u.username, u.nombre AS docenteNombre,
             cp.cod AS cicloCod, cp.nombre AS cicloNombre,
             CASE WHEN p.user_id = ? THEN 1 ELSE 0 END AS is_own
      FROM programaciones p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN ciclo_profiles cp ON cp.id = p.ciclo_id
      WHERE p.deleted_at IS NULL
        AND (p.user_id = ?
             OR p.ciclo_id IN (SELECT ciclo_id FROM user_ciclos WHERE user_id = ?))
      ORDER BY p.updated_at DESC
    `).all(req.user.id, req.user.id, req.user.id);
  }

  res.json({ modules: rows });
});

// =============================================================
// GET /api/modules/trash — Papelera
// Docente: las suyas. Admin: todas. Se vacía sola a los 30 días.
// =============================================================
router.get('/trash', requireAuth, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const rows = db.prepare(`
    SELECT p.id, p.titulo, p.codigo, p.deleted_at, p.user_id,
           u.username, u.nombre AS docenteNombre, cp.cod AS cicloCod,
           CAST(julianday(p.deleted_at, '+30 days') - julianday('now') + 0.99 AS INTEGER) AS dias_restantes
    FROM programaciones p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN ciclo_profiles cp ON cp.id = p.ciclo_id
    WHERE p.deleted_at IS NOT NULL ${isAdmin ? '' : 'AND p.user_id = ?'}
    ORDER BY p.deleted_at DESC
  `).all(...(isAdmin ? [] : [req.user.id]));
  res.json({ modules: rows });
});

// =============================================================
// POST /api/modules — Crear programación
// Body: { titulo, codigo, data, cicloId? }
// Si no se indica cicloId, se usa el primer ciclo del usuario.
// Un docente solo puede crear en ciclos a los que pertenece.
// =============================================================
router.post('/', requireAuth, (req, res) => {
  const { cicloId } = req.body;
  const titulo = cleanString(req.body.titulo || '');
  const codigo = req.body.codigo ? cleanString(String(req.body.codigo)) : req.body.codigo;
  const data   = sanitizeDeep(req.body.data || {});

  if (!titulo) {
    return res.status(400).json({ error: 'El título (nombre del módulo) es obligatorio.' });
  }

  const isAdmin = req.user.role === 'admin';
  if (cicloId && !isAdmin && !req.user.cicloIds.includes(Number(cicloId))) {
    return res.status(403).json({ error: 'No perteneces a ese ciclo.' });
  }
  const effectiveCicloId = cicloId ? Number(cicloId) : (req.user.cicloIds[0] || null);

  // Mezclar campos bloqueados del ciclo en los datos antes de guardar
  // Los campos bloqueados siempre prevalecen sobre lo que envíe el cliente
  const lockedFields = getLockedFields(effectiveCicloId);
  const finalData    = { ...data, ...lockedFields };

  const result = db.prepare(`
    INSERT INTO programaciones (user_id, ciclo_id, titulo, codigo, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, effectiveCicloId, titulo, codigo || null, JSON.stringify(finalData));

  db.audit(req, 'programacion.crear', 'programacion', result.lastInsertRowid, { titulo });
  res.status(201).json({
    module: { id: result.lastInsertRowid, titulo, codigo, cicloId: effectiveCicloId }
  });
});

// =============================================================
// PUT /api/modules/:id/estado — Cambiar el estado de trabajo
// Body: { estado: 'trabajando' | 'terminada' }  · propietario o admin
// No toca version ni updated_at (no interfiere con el guardado)
// =============================================================
const ESTADOS = ['trabajando', 'terminada'];
router.put('/:id/estado', requireAuth, (req, res) => {
  const moduleId = parseInt(req.params.id);
  const estado   = String(req.body.estado || '');
  if (!ESTADOS.includes(estado)) return res.status(400).json({ error: 'Estado no válido.' });

  const row = db.prepare('SELECT id, user_id, titulo, estado FROM programaciones WHERE id = ? AND deleted_at IS NULL').get(moduleId);
  if (!row) return res.status(404).json({ error: 'Programación no encontrada.' });
  if (row.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo el propietario o el administrador pueden cambiar el estado.' });
  }
  if (row.estado !== estado) {
    db.prepare(`UPDATE programaciones SET estado = ?, estado_at = datetime('now') WHERE id = ?`).run(estado, moduleId);
    db.audit(req, 'programacion.estado', 'programacion', moduleId, { titulo: row.titulo, estado });
  }
  const r = db.prepare('SELECT estado, estado_at FROM programaciones WHERE id = ?').get(moduleId);
  res.json({ ok: true, ...r });
});

// =============================================================
// POST /api/modules/:id/copy — Copiar una programación a un docente (solo admin)
// Body: { userId, cicloId?, titulo?, setDocente? }
//   userId     → docente que recibe la copia (será su propietario)
//   cicloId    → ciclo de la copia; por defecto el de la original si el
//                docente pertenece a él, si no el primer ciclo del docente
//   titulo     → por defecto el mismo título
//   setDocente → true (defecto): pone su nombre en el campo "Nombre del docente"
// La original no se modifica. Se aplican los campos recomendados del ciclo destino.
// =============================================================
router.post('/:id/copy', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo el administrador puede asignar copias a otros docentes.' });
  }
  const srcId = parseInt(req.params.id);
  const src = db.prepare('SELECT * FROM programaciones WHERE id = ? AND deleted_at IS NULL').get(srcId);
  if (!src) return res.status(404).json({ error: 'Programación no encontrada.' });

  const userId = parseInt(req.body.userId);
  const target = db.prepare('SELECT id, username, nombre, role, activo FROM users WHERE id = ?').get(userId);
  if (!target) return res.status(400).json({ error: 'El docente indicado no existe.' });
  if (!target.activo) return res.status(400).json({ error: 'El docente está desactivado.' });

  const targetCiclos = db.prepare('SELECT ciclo_id FROM user_ciclos WHERE user_id = ?').all(userId).map(r => r.ciclo_id);
  let cicloId;
  if (req.body.cicloId !== undefined && req.body.cicloId !== null && req.body.cicloId !== '') {
    cicloId = Number(req.body.cicloId);
    if (!db.prepare('SELECT 1 FROM ciclo_profiles WHERE id = ?').get(cicloId)) {
      return res.status(400).json({ error: 'El ciclo indicado no existe.' });
    }
  } else {
    cicloId = targetCiclos.includes(src.ciclo_id) ? src.ciclo_id : (targetCiclos[0] ?? src.ciclo_id ?? null);
  }

  const titulo = cleanString(String(req.body.titulo || src.titulo)).slice(0, 300);
  const data   = JSON.parse(src.data || '{}');
  if (req.body.setDocente !== false) data.docente = target.nombre || target.username;
  if (titulo !== src.titulo) data.modulo_nombre = titulo;
  const finalData = { ...data, ...getLockedFields(cicloId) };

  const result = db.prepare(`
    INSERT INTO programaciones (user_id, ciclo_id, titulo, codigo, data, last_saved_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, cicloId, titulo, src.codigo, JSON.stringify(finalData), req.user.id);

  db.audit(req, 'programacion.copiar_a_docente', 'programacion', result.lastInsertRowid, {
    origen: src.titulo, origen_id: srcId, docente: target.username, ciclo_id: cicloId,
  });
  res.status(201).json({
    module: { id: result.lastInsertRowid, titulo, userId, cicloId },
    warning: cicloId && !targetCiclos.includes(cicloId)
      ? 'El docente no pertenece al ciclo de la copia. Podrá editarla igualmente, y la verán en solo lectura los docentes de ese ciclo.'
      : null,
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
    WHERE p.id = ? AND p.deleted_at IS NULL
  `).get(moduleId);

  if (!row) return res.status(404).json({ error: 'Programación no encontrada.' });

  // Comprobar permisos de acceso
  const isOwner    = row.user_id  === req.user.id;
  const isAdmin    = req.user.role === 'admin';
  const sameCiclo  = !!row.ciclo_id && req.user.cicloIds.includes(row.ciclo_id);
  const readOnly   = !isOwner && !isAdmin; // docente de mismo ciclo → solo lectura

  if (!isOwner && !isAdmin && !sameCiclo) {
    return res.status(403).json({ error: 'No tienes acceso a esta programación.' });
  }

  // Mezclar campos bloqueados para que el frontend los reciba siempre correctos
  const lockedFields = getLockedFields(row.ciclo_id);
  const data         = { ...JSON.parse(row.data || '{}'), ...lockedFields };
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
      version:      row.version,
      estado:       row.estado,
      estado_at:    row.estado_at,
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
// Body: { titulo?, codigo?, data?, cicloId?, expectedVersion? }
//   cicloId          → permite cambiar de ciclo
//   expectedVersion  → bloqueo optimista: si la programación se ha guardado
//                      desde otra sesión (version distinta) → 409
// =============================================================
router.put('/:id', requireAuth, (req, res) => {
  const moduleId = parseInt(req.params.id);
  const { cicloId } = req.body;
  const titulo = req.body.titulo != null ? cleanString(String(req.body.titulo)) : undefined;
  const codigo = req.body.codigo != null ? cleanString(String(req.body.codigo)) : undefined;
  const data   = req.body.data ? sanitizeDeep(req.body.data) : undefined;

  const row = db.prepare(
    'SELECT * FROM programaciones WHERE id = ? AND deleted_at IS NULL'
  ).get(moduleId);

  if (!row) return res.status(404).json({ error: 'Programación no encontrada.' });

  // Solo propietario o admin pueden editar
  if (row.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'No tienes permiso para editar esta programación.' });
  }

  // Bloqueo optimista
  const { expectedVersion } = req.body;
  if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== row.version) {
    return res.status(409).json({
      error: 'La programación se ha modificado en otra sesión.',
      currentVersion: row.version,
      updated_at: row.updated_at,
    });
  }

  // Cambio de ciclo (opcional): docente solo a ciclos a los que pertenece
  let newCicloId = row.ciclo_id;
  if (cicloId !== undefined) {
    newCicloId = cicloId ? Number(cicloId) : null;
    if (newCicloId && req.user.role !== 'admin' && !req.user.cicloIds.includes(newCicloId)) {
      return res.status(403).json({ error: 'No perteneces a ese ciclo.' });
    }
  }

  // Los campos bloqueados del ciclo siempre prevalecen (no se pueden editar)
  const lockedFields = getLockedFields(newCicloId);
  const currentData  = JSON.parse(row.data || '{}');
  const finalData    = { ...currentData, ...(data || {}), ...lockedFields };

  const newJson = JSON.stringify(finalData);
  db.transaction(() => {
    // Historial: guardar el estado anterior (como mucho 1 por hora, o si cambia el autor)
    if (newJson !== row.data || (titulo ?? row.titulo) !== row.titulo) db.snapshot(row, req.user.id);

    db.prepare(`
      UPDATE programaciones
      SET titulo = ?, codigo = ?, data = ?, ciclo_id = ?, last_saved_by = ?,
          version = version + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      titulo ?? row.titulo,
      codigo ?? row.codigo,
      newJson,
      newCicloId,
      req.user.id,
      moduleId
    );
  })();

  if (newCicloId !== row.ciclo_id) {
    db.audit(req, 'programacion.cambiar_ciclo', 'programacion', moduleId,
             { titulo: row.titulo, de: row.ciclo_id, a: newCicloId });
  }

  const upd = db.prepare('SELECT version, updated_at FROM programaciones WHERE id = ?').get(moduleId);
  res.json({ ok: true, version: upd.version, updated_at: upd.updated_at });
});

// Helper: comprobar que el usuario puede gestionar (editar/borrar) una programación
function canManage(req, row) {
  return row.user_id === req.user.id || req.user.role === 'admin';
}

// =============================================================
// DELETE /api/modules/:id — Mover a la papelera (borrado lógico)
// Solo el propietario o el admin. Se elimina del todo a los 30 días.
// =============================================================
router.delete('/:id', requireAuth, (req, res) => {
  const moduleId = parseInt(req.params.id);
  const row = db.prepare('SELECT id, user_id, titulo FROM programaciones WHERE id = ? AND deleted_at IS NULL').get(moduleId);
  if (!row) return res.status(404).json({ error: 'Programación no encontrada.' });
  if (!canManage(req, row)) {
    return res.status(403).json({ error: 'No tienes permiso para eliminar esta programación.' });
  }

  db.prepare(`UPDATE programaciones SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?`)
    .run(req.user.id, moduleId);
  db.audit(req, 'programacion.papelera', 'programacion', moduleId, { titulo: row.titulo });
  res.json({ ok: true });
});

// =============================================================
// POST /api/modules/:id/restore — Sacar de la papelera
// =============================================================
router.post('/:id/restore', requireAuth, (req, res) => {
  const moduleId = parseInt(req.params.id);
  const row = db.prepare('SELECT id, user_id, titulo FROM programaciones WHERE id = ? AND deleted_at IS NOT NULL').get(moduleId);
  if (!row) return res.status(404).json({ error: 'No está en la papelera.' });
  if (!canManage(req, row)) return res.status(403).json({ error: 'No tienes permiso.' });

  db.prepare(`UPDATE programaciones SET deleted_at = NULL, deleted_by = NULL, updated_at = datetime('now') WHERE id = ?`).run(moduleId);
  db.audit(req, 'programacion.recuperar', 'programacion', moduleId, { titulo: row.titulo });
  res.json({ ok: true });
});

// =============================================================
// DELETE /api/modules/:id/purge — Eliminar definitivamente (desde papelera)
// =============================================================
router.delete('/:id/purge', requireAuth, (req, res) => {
  const moduleId = parseInt(req.params.id);
  const row = db.prepare('SELECT id, user_id, titulo FROM programaciones WHERE id = ? AND deleted_at IS NOT NULL').get(moduleId);
  if (!row) return res.status(404).json({ error: 'No está en la papelera.' });
  if (!canManage(req, row)) return res.status(403).json({ error: 'No tienes permiso.' });

  db.prepare('DELETE FROM programaciones WHERE id = ?').run(moduleId);
  db.audit(req, 'programacion.eliminar_definitiva', 'programacion', moduleId, { titulo: row.titulo });
  res.json({ ok: true });
});

// =============================================================
// GET /api/modules/:id/versions — Historial de versiones
// Solo propietario o admin
// =============================================================
router.get('/:id/versions', requireAuth, (req, res) => {
  const moduleId = parseInt(req.params.id);
  const row = db.prepare('SELECT id, user_id FROM programaciones WHERE id = ? AND deleted_at IS NULL').get(moduleId);
  if (!row) return res.status(404).json({ error: 'Programación no encontrada.' });
  if (!canManage(req, row)) return res.status(403).json({ error: 'No tienes permiso.' });

  const versions = db.prepare(`
    SELECT v.id, v.version, v.titulo, v.saved_at, v.reason, LENGTH(v.data) AS size,
           u.username, u.nombre
    FROM programacion_versions v
    LEFT JOIN users u ON u.id = v.saved_by
    WHERE v.programacion_id = ?
    ORDER BY v.id DESC
  `).all(moduleId);
  res.json({ versions });
});

// =============================================================
// POST /api/modules/:id/versions/:vid/restore — Restaurar una versión
// Antes guarda el estado actual en el historial (se puede deshacer)
// =============================================================
router.post('/:id/versions/:vid/restore', requireAuth, (req, res) => {
  const moduleId = parseInt(req.params.id);
  const vid      = parseInt(req.params.vid);
  const row = db.prepare('SELECT * FROM programaciones WHERE id = ? AND deleted_at IS NULL').get(moduleId);
  if (!row) return res.status(404).json({ error: 'Programación no encontrada.' });
  if (!canManage(req, row)) return res.status(403).json({ error: 'No tienes permiso.' });

  const v = db.prepare('SELECT * FROM programacion_versions WHERE id = ? AND programacion_id = ?').get(vid, moduleId);
  if (!v) return res.status(404).json({ error: 'Versión no encontrada.' });

  // Los campos bloqueados del ciclo actual siguen prevaleciendo
  const data = JSON.stringify({ ...JSON.parse(v.data || '{}'), ...getLockedFields(row.ciclo_id) });

  db.transaction(() => {
    db.snapshot(row, req.user.id, 'antes-de-restaurar');
    db.prepare(`
      UPDATE programaciones
      SET titulo = ?, codigo = ?, data = ?, last_saved_by = ?,
          version = version + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(v.titulo ?? row.titulo, v.codigo ?? row.codigo, data, req.user.id, moduleId);
  })();

  db.audit(req, 'programacion.restaurar_version', 'programacion', moduleId,
           { titulo: row.titulo, desde: v.saved_at });
  res.json({ ok: true });
});

module.exports = router;
