// =============================================================
// backend/routes/backup.js — Copia de seguridad completa
//
// Solo accesible para el administrador.
//
// GET  /api/backup         — Exportar todo: perfiles, usuarios y módulos
// POST /api/backup/restore — Restaurar desde una copia de seguridad v3
//
// Las contraseñas nunca se exportan. Al restaurar, los docentes
// reciben la contraseña temporal indicada en el body (por defecto
// "cambiar1234"). El admin debe comunicársela y pedirles que la
// cambien en su primer inicio de sesión.
// =============================================================

const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// =============================================================
// GET /api/backup — Exportar todo (solo admin)
// =============================================================
router.get('/', requireAdmin, (req, res) => {
  // Perfiles de ciclo con sus campos sugeridos
  const profiles = db.prepare(`
    SELECT id, cod, nombre, locked_fields
    FROM ciclo_profiles
    ORDER BY nombre ASC
  `).all().map(p => ({
    id:           p.id,
    cod:          p.cod,
    nombre:       p.nombre,
    locked_fields: JSON.parse(p.locked_fields || '[]'),
  }));

  // Usuarios docentes (sin contraseñas)
  const users = db.prepare(`
    SELECT id, username, nombre, role, activo
    FROM users
    WHERE role != 'admin'
    ORDER BY username ASC
  `).all().map(u => ({
    id:       u.id,
    username: u.username,
    nombre:   u.nombre,
    role:     u.role,
    activo:   u.activo,
    ciclos:   db.prepare(`
      SELECT cp.cod, cp.nombre
      FROM user_ciclos uc
      JOIN ciclo_profiles cp ON cp.id = uc.ciclo_id
      WHERE uc.user_id = ?
      ORDER BY cp.nombre ASC
    `).all(u.id),
  }));

  // Todas las programaciones con datos completos
  const modules = db.prepare(`
    SELECT p.titulo, p.codigo, p.data,
           u.username  AS ownerUsername,
           cp.cod      AS cicloCod
    FROM programaciones p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN ciclo_profiles cp ON cp.id = p.ciclo_id
    ORDER BY p.id ASC
  `).all().map(r => ({
    titulo:        r.titulo,
    codigo:        r.codigo,
    data:          JSON.parse(r.data || '{}'),
    cicloCod:      r.cicloCod   || null,
    ownerUsername: r.ownerUsername,
  }));

  res.json({
    version:    3,
    exportDate: new Date().toISOString(),
    profiles,
    users,
    modules,
  });
});

// =============================================================
// POST /api/backup/restore — Restaurar desde backup v3 (solo admin)
//
// Body: {
//   profiles:        [...],
//   users:           [...],
//   modules:         [...],
//   defaultPassword: "cambiar1234"   (opcional)
// }
//
// Estrategia:
//   - Perfiles: se crean si no existen; si ya existen, se actualizan
//     nombre y locked_fields con los del backup (los campos sugeridos
//     siempre se restauran).
//   - Usuarios: se crean si no existe ya uno con el mismo username.
//     Si ya existe, se usa el existente (no se sobreescribe).
//   - Módulos: siempre se crean (pueden quedar duplicados si ya
//     existían; es responsabilidad del admin limpiarlos).
// =============================================================
router.post('/restore', requireAdmin, (req, res) => {
  const {
    profiles       = [],
    users          = [],
    modules        = [],
    defaultPassword = 'cambiar1234',
  } = req.body;

  if (defaultPassword.length < 6) {
    return res.status(400).json({ error: 'La contraseña temporal debe tener al menos 6 caracteres.' });
  }

  const results = { profiles: 0, profilesUpdated: 0, users: 0, modules: 0, skipped: 0, errors: [] };

  // ── 1. Perfiles ──────────────────────────────────────────
  // Mapa cod → id (incluye los ya existentes)
  const cicloMap = {};
  db.prepare('SELECT id, cod FROM ciclo_profiles').all()
    .forEach(p => { cicloMap[p.cod] = p.id; });

  for (const p of profiles) {
    if (!p.cod || !p.nombre) continue;
    if (cicloMap[p.cod] !== undefined) {
      // El perfil ya existe: actualizar nombre y locked_fields con los del backup
      try {
        db.prepare(`
          UPDATE ciclo_profiles SET nombre = ?, locked_fields = ? WHERE id = ?
        `).run(p.nombre, JSON.stringify(p.locked_fields || []), cicloMap[p.cod]);
        results.profilesUpdated++;
      } catch (e) {
        results.errors.push(`Perfil ${p.cod} (actualizar): ${e.message}`);
      }
      continue;
    }
    try {
      const r = db.prepare(`
        INSERT INTO ciclo_profiles (cod, nombre, locked_fields)
        VALUES (?, ?, ?)
      `).run(p.cod, p.nombre, JSON.stringify(p.locked_fields || []));
      cicloMap[p.cod] = r.lastInsertRowid;
      results.profiles++;
    } catch (e) {
      results.errors.push(`Perfil ${p.cod}: ${e.message}`);
    }
  }

  // ── 2. Usuarios ──────────────────────────────────────────
  // Mapa username → id (incluye los ya existentes)
  const userMap = {};
  db.prepare('SELECT id, username FROM users').all()
    .forEach(u => { userMap[u.username] = u.id; });

  const pwHash = bcrypt.hashSync(defaultPassword, 12);

  for (const u of users) {
    if (!u.username || u.role === 'admin') continue;
    if (userMap[u.username] !== undefined) {
      results.skipped++;
      continue; // ya existe, no sobreescribimos
    }
    try {
      const r = db.prepare(`
        INSERT INTO users (username, password_hash, role, nombre, activo)
        VALUES (?, ?, 'docente', ?, ?)
      `).run(u.username, pwHash, u.nombre || null, u.activo ? 1 : 0);
      const newId = r.lastInsertRowid;
      userMap[u.username] = newId;

      // Asignar ciclos usando el mapa cod → id
      const cicloInsert = db.prepare(
        'INSERT OR IGNORE INTO user_ciclos (user_id, ciclo_id) VALUES (?, ?)'
      );
      for (const c of (u.ciclos || [])) {
        const cid = cicloMap[c.cod];
        if (cid !== undefined) cicloInsert.run(newId, cid);
      }
      results.users++;
    } catch (e) {
      results.errors.push(`Usuario ${u.username}: ${e.message}`);
    }
  }

  // ── 3. Módulos ───────────────────────────────────────────
  const adminRow = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  const adminId  = adminRow?.id;

  for (const m of modules) {
    if (!m.titulo) continue;
    const cicloId = m.cicloCod ? (cicloMap[m.cicloCod] ?? null) : null;
    const userId  = m.ownerUsername ? (userMap[m.ownerUsername] ?? adminId) : adminId;
    try {
      db.prepare(`
        INSERT INTO programaciones (user_id, ciclo_id, titulo, codigo, data)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, cicloId, m.titulo, m.codigo || null, JSON.stringify(m.data || {}));
      results.modules++;
    } catch (e) {
      results.errors.push(`Módulo "${m.titulo}": ${e.message}`);
    }
  }

  res.json({ ok: true, results });
});

module.exports = router;
