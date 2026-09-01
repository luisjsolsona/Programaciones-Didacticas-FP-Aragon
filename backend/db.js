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
`);

// =============================================================
// USUARIO ADMIN POR DEFECTO
// Se crea solo si no existe ningún admin en la BD.
// La contraseña viene de la variable de entorno ADMIN_PASSWORD.
// =============================================================

const adminExists = db.prepare(
  `SELECT id FROM users WHERE role = 'admin' LIMIT 1`
).get();

if (!adminExists) {
  const rawPassword = process.env.ADMIN_PASSWORD || 'admin1234';
  const hash = bcrypt.hashSync(rawPassword, 12);

  db.prepare(`
    INSERT INTO users (username, password_hash, role, nombre)
    VALUES ('admin', ?, 'admin', 'Administrador')
  `).run(hash);

  console.log('[DB] Usuario admin creado con contraseña:', rawPassword);
  console.log('[DB] ⚠️  Cambia la contraseña tras el primer login.');
}

module.exports = db;
