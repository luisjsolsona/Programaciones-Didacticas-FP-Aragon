// =============================================================
// backend/server.js — Punto de entrada del servidor Express
//
// Responsabilidades:
//   - Configurar middlewares globales (CORS, cookies, JSON)
//   - Montar las rutas de la API bajo /api/
//   - Ruta de health check para Docker
//   - Arrancar el servidor en el puerto configurado
// =============================================================

// ── Comprobaciones de arranque: sin secretos no se arranca ──
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('[Server] ❌ JWT_SECRET no definido o demasiado corto (mín. 32 caracteres) en .env');
  console.error('           Genera uno con:  openssl rand -hex 32');
  process.exit(1);
}

const express      = require('express');
const cookieParser = require('cookie-parser');

// Inicializar la BD al arrancar (crea tablas y admin por defecto)
const db = require('./db');
const { sanitizeDeep } = require('./sanitize');
const { startBackupScheduler } = require('./backup-scheduler');
const APP_VERSION = require('./package.json').version;

// Importar rutas
const authRoutes     = require('./routes/auth');
const usersRoutes    = require('./routes/users');
const profilesRoutes = require('./routes/profiles');
const modulesRoutes  = require('./routes/modules');
const backupRoutes   = require('./routes/backup');
const cateduRoutes   = require('./routes/catedu');
const exportRoutes   = require('./routes/export');
const auditRoutes    = require('./routes/audit');
const resetRoutes    = require('./routes/reset');

const app  = express();

// Detrás de Caddy → Nginx (redes Docker privadas): confiar en esos proxies
// para obtener la IP real del cliente (req.ip) y si la conexión es HTTPS (req.secure)
app.set('trust proxy', 'loopback, uniquelocal');
app.disable('x-powered-by');
const PORT = process.env.PORT || 3001;

// =============================================================
// MIDDLEWARES GLOBALES
// =============================================================

// Parsear cuerpos JSON en las peticiones
app.use(express.json({ limit: '20mb' }));

// Parsear cookies (necesario para leer el JWT de la cookie httpOnly)
app.use(cookieParser());

// CORS: solo permite peticiones desde el frontend (Nginx en el mismo compose)
// En desarrollo puedes añadir 'http://localhost:3000'

// =============================================================
// RUTAS DE LA API
// =============================================================

// POST /api/auth/login   — Iniciar sesión
// POST /api/auth/logout  — Cerrar sesión
// GET  /api/auth/me      — Obtener usuario autenticado
app.use('/api/auth', authRoutes);

// GET    /api/users          — Listar docentes (solo admin)
// POST   /api/users          — Crear docente (solo admin)
// PUT    /api/users/:id      — Editar docente (solo admin)
// DELETE /api/users/:id      — Eliminar docente (solo admin)
// PUT    /api/users/:id/password — Cambiar contraseña (propio usuario o admin)
app.use('/api/users', usersRoutes);

// GET    /api/profiles       — Listar perfiles de ciclo
// POST   /api/profiles       — Crear perfil (solo admin)
// PUT    /api/profiles/:id   — Editar perfil (solo admin)
// DELETE /api/profiles/:id   — Eliminar perfil (solo admin)
app.use('/api/profiles', profilesRoutes);

// GET    /api/modules          — Listar programaciones del usuario (o todas si admin)
// POST   /api/modules          — Crear programación
// GET    /api/modules/:id      — Obtener programación (propietario, mismo ciclo o admin)
// PUT    /api/modules/:id      — Editar programación (solo propietario o admin)
// DELETE /api/modules/:id      — Eliminar programación (solo propietario o admin)
app.use('/api/modules', modulesRoutes);

// GET/POST /api/backup — Copia completa: ciclos, docentes y programaciones (solo admin)
app.use('/api/backup', backupRoutes);

// GET /api/catedu?url=… — Lectura de centrosdocentes.catedu.es (importador)
app.use('/api/catedu', cateduRoutes);

// POST /api/export/docx — Genera el .docx de una programación
app.use('/api/export', exportRoutes);

// GET /api/audit — Registro de auditoría (solo admin)
app.use('/api/audit', auditRoutes);

// POST /api/admin/reset — Borrado masivo con confirmación (solo admin)
app.use('/api/admin/reset', resetRoutes);

// =============================================================
// HEALTH CHECK
// Usado por Docker para saber si el servicio está activo
// =============================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: APP_VERSION, timestamp: new Date().toISOString() });
});

// =============================================================
// ARRANQUE
// =============================================================
// ── Migración única: sanear HTML ya guardado (protección XSS) ──
if (!db.prepare(`SELECT 1 FROM app_meta WHERE key = 'sanitized_v1'`).get()) {
  // Copia de seguridad previa por si hubiera que revertir
  const fs = require('fs');
  fs.mkdirSync('/app/data/backups', { recursive: true });
  const pre = `/app/data/backups/pre-saneado-${Date.now()}.sqlite`;
  db.exec(`VACUUM INTO '${pre}'`);
  console.log(`[DB] Copia previa al saneado: ${pre}`);

  let n = 0;
  db.transaction(() => {
    const upd = db.prepare('UPDATE programaciones SET data = ?, titulo = ? WHERE id = ?');
    for (const p of db.prepare('SELECT id, titulo, data FROM programaciones').all()) {
      const clean = JSON.stringify(sanitizeDeep(JSON.parse(p.data || '{}')));
      const tit   = sanitizeDeep(p.titulo);
      if (clean !== p.data || tit !== p.titulo) { upd.run(clean, tit, p.id); n++; }
    }
    const updC = db.prepare('UPDATE ciclo_profiles SET locked_fields = ? WHERE id = ?');
    for (const c of db.prepare('SELECT id, locked_fields FROM ciclo_profiles').all()) {
      const clean = JSON.stringify(sanitizeDeep(JSON.parse(c.locked_fields || '[]')));
      if (clean !== c.locked_fields) { updC.run(clean, c.id); n++; }
    }
    db.prepare(`INSERT INTO app_meta (key, value) VALUES ('sanitized_v1', datetime('now'))`).run();
  })();
  console.log(`[DB] Saneado HTML inicial: ${n} registros actualizados.`);
}

startBackupScheduler();

app.listen(PORT, () => {
  console.log(`[Server] Backend escuchando en http://localhost:${PORT}`);
  console.log(`[Server] Entorno: ${process.env.NODE_ENV || 'development'}`);
});
