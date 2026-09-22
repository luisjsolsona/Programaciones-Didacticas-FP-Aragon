// =============================================================
// backend/db.js — Inicialización y acceso a la base de datos
//
// Usa better-sqlite3 (síncrono, sin promesas) sobre SQLite.
// Se encarga de:
//   1. Crear el fichero de BD si no existe
//   2. Crear las tablas necesarias (si no existen)
//   3. Insertar el usuario admin por defecto al primer arranque
//   4. Exportar el objeto `db` para usar en el resto del código
// =============================================================

const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const path     = require('path');

// La BD se guarda en /app/data/db.sqlite (montado como volumen)
const DB_PATH = path.join('/app/data', 'db.sqlite');

const db = new Database(DB_PATH);

// Activar WAL para mejor rendimiento en escrituras concurrentes
db.pragma('journal_mode = WAL');
// Activar claves foráneas
db.pragma('foreign_keys = ON');

// =============================================================
// CREACIÓN DE TABLAS
// =============================================================

// ¿Existía ya la tabla user_ciclos? (para migrar solo la primera vez)
const hadUserCiclos = !!db.prepare(
  `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_ciclos'`
).get();

db.exec(`

  -- Perfiles de ciclo formativo
  -- Cada perfil define qué campos están bloqueados y con qué valor
  -- locked_fields: JSON array de { key, value, label }
  CREATE TABLE IF NOT EXISTS ciclo_profiles (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    cod           TEXT    NOT NULL UNIQUE,   -- Ej: IFC201
    nombre        TEXT    NOT NULL,          -- Ej: Sistemas Microinformáticos y Redes
    locked_fields TEXT    NOT NULL DEFAULT '[]', -- JSON
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Usuarios del sistema
  -- role: 'admin' | 'docente'
  -- ciclo_id: NULL para admin, obligatorio para docentes
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'docente',
    ciclo_id      INTEGER REFERENCES ciclo_profiles(id) ON DELETE SET NULL,
    nombre        TEXT,                      -- Nombre real del docente
    activo        INTEGER NOT NULL DEFAULT 1, -- 1=activo, 0=desactivado
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Programaciones didácticas
  -- data: JSON con todos los campos del formulario
  -- Cada programación pertenece a un usuario y a un ciclo
  CREATE TABLE IF NOT EXISTS programaciones (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ciclo_id   INTEGER REFERENCES ciclo_profiles(id) ON DELETE SET NULL,
    titulo     TEXT    NOT NULL,             -- Nombre del módulo (para la lista)
    codigo     TEXT,                         -- Código del módulo (ej: 0222)
    data       TEXT    NOT NULL DEFAULT '{}', -- JSON con todos los campos
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Índices para acelerar las consultas más frecuentes
  CREATE INDEX IF NOT EXISTS idx_prog_user    ON programaciones(user_id);
  CREATE INDEX IF NOT EXISTS idx_prog_ciclo   ON programaciones(ciclo_id);
  CREATE INDEX IF NOT EXISTS idx_users_ciclo  ON users(ciclo_id);

  -- Relación N:M docente ↔ ciclo (un docente puede estar en varios ciclos)
  -- users.ciclo_id se mantiene como "ciclo principal" (el primero) por compatibilidad
  CREATE TABLE IF NOT EXISTS user_ciclos (
    user_id  INTEGER NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
    ciclo_id INTEGER NOT NULL REFERENCES ciclo_profiles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, ciclo_id)
  );
  CREATE INDEX IF NOT EXISTS idx_uc_ciclo ON user_ciclos(ciclo_id);
`);

// Columna token_version: al incrementarla se invalidan las sesiones del usuario
// (cambio de contraseña). Se añade si la BD es anterior.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('users') WHERE name = 'token_version'`).get()) {
  db.exec(`ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0`);
}

// Columna version en programaciones: bloqueo optimista al guardar
// (detecta si otra sesión ha guardado entretanto)
if (!db.prepare(`SELECT 1 FROM pragma_table_info('programaciones') WHERE name = 'version'`).get()) {
  db.exec(`ALTER TABLE programaciones ADD COLUMN version INTEGER NOT NULL DEFAULT 0`);
}

// Quién hizo el último guardado (para el historial)
if (!db.prepare(`SELECT 1 FROM pragma_table_info('programaciones') WHERE name = 'last_saved_by'`).get()) {
  db.exec(`ALTER TABLE programaciones ADD COLUMN last_saved_by INTEGER`);
}

// Papelera: borrado lógico de programaciones
if (!db.prepare(`SELECT 1 FROM pragma_table_info('programaciones') WHERE name = 'deleted_at'`).get()) {
  db.exec(`ALTER TABLE programaciones ADD COLUMN deleted_at TEXT`);
  db.exec(`ALTER TABLE programaciones ADD COLUMN deleted_by INTEGER`);
}

db.exec(`
  -- Historial: instantáneas del estado ANTERIOR de cada programación
  CREATE TABLE IF NOT EXISTS programacion_versions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    programacion_id  INTEGER NOT NULL REFERENCES programaciones(id) ON DELETE CASCADE,
    version          INTEGER NOT NULL,
    titulo           TEXT,
    codigo           TEXT,
    ciclo_id         INTEGER,
    data             TEXT    NOT NULL,
    saved_by         INTEGER,            -- quién guardó ESE estado
    saved_at         TEXT    NOT NULL,   -- cuándo se guardó ESE estado
    reason           TEXT    NOT NULL DEFAULT 'auto', -- auto | antes-de-restaurar
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))  -- cuándo se tomó la instantánea
  );
  CREATE INDEX IF NOT EXISTS idx_pv_prog ON programacion_versions(programacion_id, id);

  -- Auditoría de acciones relevantes
  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    at          TEXT    NOT NULL DEFAULT (datetime('now')),
    user_id     INTEGER,
    username    TEXT,
    action      TEXT    NOT NULL,
    target_type TEXT,
    target_id   INTEGER,
    detail      TEXT,
    ip          TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
`);

// Tabla de migraciones puntuales (para ejecutar cada una una sola vez)
db.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)`);

// Migración única: copiar el ciclo actual de cada usuario a user_ciclos
if (!hadUserCiclos) {
  const n = db.prepare(`
    INSERT OR IGNORE INTO user_ciclos (user_id, ciclo_id)
    SELECT id, ciclo_id FROM users WHERE ciclo_id IS NOT NULL
  `).run().changes;
  console.log(`[DB] Migración user_ciclos: ${n} asignaciones copiadas.`);
}

// =============================================================
// USUARIO ADMIN POR DEFECTO
// Se crea solo si no existe ningún admin en la BD.
// La contraseña viene de la variable de entorno ADMIN_PASSWORD.
// =============================================================

const adminExists = db.prepare(
  `SELECT id FROM users WHERE role = 'admin' LIMIT 1`
).get();

if (!adminExists) {
  const rawPassword = process.env.ADMIN_PASSWORD;
  if (!rawPassword || rawPassword.length < 8) {
    console.error('[DB] ❌ No existe usuario admin y ADMIN_PASSWORD no está definida (mín. 8 caracteres) en .env');
    process.exit(1);
  }
  const hash = bcrypt.hashSync(rawPassword, 12);

  db.prepare(`
    INSERT INTO users (username, password_hash, role, nombre)
    VALUES ('admin', ?, 'admin', 'Administrador')
  `).run(hash);

  console.log('[DB] Usuario admin creado. La contraseña es la que hayas puesto en ADMIN_PASSWORD (no se muestra aquí por seguridad).');
  console.log('[DB] ⚠️  Cambia la contraseña tras el primer login.');
}

// =============================================================
// HELPERS: ciclos de un usuario
// =============================================================

// Devuelve [{ id, cod, nombre }] ordenados por código
db.getUserCiclos = (userId) => db.prepare(`
  SELECT cp.id, cp.cod, cp.nombre
  FROM user_ciclos uc JOIN ciclo_profiles cp ON cp.id = uc.ciclo_id
  WHERE uc.user_id = ?
  ORDER BY cp.cod
`).all(userId);

// Sustituye los ciclos del usuario y sincroniza users.ciclo_id (principal)
db.setUserCiclos = db.transaction((userId, cicloIds) => {
  const ids = [...new Set((cicloIds || []).map(Number).filter(Boolean))];
  db.prepare('DELETE FROM user_ciclos WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT INTO user_ciclos (user_id, ciclo_id) VALUES (?, ?)');
  ids.forEach(cid => ins.run(userId, cid));
  db.prepare('UPDATE users SET ciclo_id = ? WHERE id = ?').run(ids[0] || null, userId);
});

// Valida que todos los ids existen; devuelve el primero que no existe o null
db.findMissingCiclo = (cicloIds) => {
  const q = db.prepare('SELECT id FROM ciclo_profiles WHERE id = ?');
  return (cicloIds || []).find(id => !q.get(Number(id))) ?? null;
};

// Normaliza el body: acepta cicloIds (array) o cicloId (legacy)
db.parseCicloIds = (body) => {
  if (Array.isArray(body.cicloIds)) return body.cicloIds.map(Number).filter(Boolean);
  if (body.cicloId !== undefined)  return body.cicloId ? [Number(body.cicloId)] : [];
  return undefined; // no se ha enviado
};

// =============================================================
// HELPERS: auditoría, historial y mantenimiento
// =============================================================

// Registra una acción. req puede ser null; user permite indicar
// usuario explícito (p. ej. login fallido sin req.user)
db.audit = (req, action, targetType = null, targetId = null, detail = null, user = null) => {
  try {
    const uid = user?.id ?? req?.user?.id ?? null;
    const uname = user?.username
      ?? (uid ? db.prepare('SELECT username FROM users WHERE id = ?').get(uid)?.username : null);
    db.prepare(`
      INSERT INTO audit_log (user_id, username, action, target_type, target_id, detail, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uid, uname || null, action, targetType, targetId,
           detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 1000),
           req?.ip || null);
  } catch (e) { console.error('[Audit]', e.message); }
};

const SNAPSHOT_EVERY_MIN = 60;   // como mucho una instantánea automática por hora
const SNAPSHOT_KEEP      = 40;   // por programación

// Guarda el estado actual (row de programaciones) antes de modificarlo.
// Automática: solo si la última instantánea tiene más de 1 h o era de otro usuario.
db.snapshot = (row, userId, reason = 'auto') => {
  if (reason === 'auto') {
    const last = db.prepare(`
      SELECT created_at FROM programacion_versions
      WHERE programacion_id = ? ORDER BY id DESC LIMIT 1
    `).get(row.id);
    const lastUserSaved = row.last_saved_by ?? null;
    if (last) {
      const ageMin = (Date.now() - Date.parse(last.created_at.replace(' ', 'T') + 'Z')) / 60000;
      if (ageMin < SNAPSHOT_EVERY_MIN && (lastUserSaved == null || lastUserSaved === userId)) return false;
    }
  }
  db.prepare(`
    INSERT INTO programacion_versions (programacion_id, version, titulo, codigo, ciclo_id, data, saved_by, saved_at, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.version || 0, row.titulo, row.codigo, row.ciclo_id, row.data,
         row.last_saved_by ?? row.user_id, row.updated_at, reason);
  db.prepare(`
    DELETE FROM programacion_versions WHERE programacion_id = ? AND id NOT IN (
      SELECT id FROM programacion_versions WHERE programacion_id = ? ORDER BY id DESC LIMIT ?
    )
  `).run(row.id, row.id, SNAPSHOT_KEEP);
  return true;
};

// Limpieza diaria: papelera > 30 días y auditoría > 1 año
db.maintenance = () => {
  const purged = db.prepare(`
    DELETE FROM programaciones WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-30 days')
  `).run().changes;
  const oldAudit = db.prepare(`DELETE FROM audit_log WHERE at < datetime('now', '-365 days')`).run().changes;
  if (purged || oldAudit) console.log(`[Mantenimiento] Papelera vaciada: ${purged} · auditoría antigua: ${oldAudit}`);
  return { purged, oldAudit };
};

module.exports = db;
