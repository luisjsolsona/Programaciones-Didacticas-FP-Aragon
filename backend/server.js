// =============================================================
// backend/server.js — Punto de entrada del servidor Express
//
// Responsabilidades:
//   - Configurar middlewares globales (CORS, cookies, JSON)
//   - Montar las rutas de la API bajo /api/
//   - Ruta de health check para Docker
//   - Arrancar el servidor en el puerto configurado
// =============================================================

const express      = require('express');
const cookieParser = require('cookie-parser');
const cors         = require('cors');

// Inicializar la BD al arrancar (crea tablas y admin por defecto)
require('./db');

// Importar rutas
const authRoutes     = require('./routes/auth');
const usersRoutes    = require('./routes/users');
const profilesRoutes = require('./routes/profiles');
const modulesRoutes  = require('./routes/modules');
const backupRoutes   = require('./routes/backup');

const app  = express();
const PORT = process.env.PORT || 3001;

// =============================================================
// MIDDLEWARES GLOBALES
// =============================================================

// Parsear cuerpos JSON en las peticiones (límite 50 MB para backups completos)
app.use(express.json({ limit: '50mb' }));

// Parsear cookies (necesario para leer el JWT de la cookie httpOnly)
app.use(cookieParser());

// CORS: solo permite peticiones desde el frontend (Nginx en el mismo compose)
// En desarrollo puedes añadir 'http://localhost:3000'
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  credentials: true,  // Necesario para enviar/recibir cookies
}));

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

// GET  /api/backup         — Exportar todo (solo admin)
// POST /api/backup/restore — Restaurar desde backup v3 (solo admin)
app.use('/api/backup', backupRoutes);

// =============================================================
// HEALTH CHECK
// Usado por Docker para saber si el servicio está activo
// =============================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// =============================================================
// ARRANQUE
// =============================================================
app.listen(PORT, () => {
  console.log(`[Server] Backend escuchando en http://localhost:${PORT}`);
  console.log(`[Server] Entorno: ${process.env.NODE_ENV || 'development'}`);
});
