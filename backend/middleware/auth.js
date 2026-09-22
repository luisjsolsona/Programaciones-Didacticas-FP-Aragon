// =============================================================
// backend/middleware/auth.js — Middlewares de autenticación
//
// Exporta dos middlewares:
//
//   requireAuth   — Verifica que el JWT en la cookie es válido.
//                   Si no lo es, devuelve 401.
//                   Si es válido, añade req.user = { id, role, cicloIds, cicloId }
//
//   requireAdmin  — Usa requireAuth y además exige role === 'admin'.
//                   Si no es admin, devuelve 403.
//
// Uso en rutas:
//   router.get('/ruta', requireAuth, handler)
//   router.post('/admin-ruta', requireAdmin, handler)
// =============================================================

const jwt = require('jsonwebtoken');
const db  = require('../db');

// server.js impide arrancar sin JWT_SECRET, así que aquí siempre existe
const SECRET    = process.env.JWT_SECRET;
const TOKEN_TTL = '8h';

// -------------------------------------------------------------
// issueSession — Firma el JWT y lo guarda en la cookie httpOnly
// user: fila de users (id, role, token_version)
// -------------------------------------------------------------
function issueSession(req, res, user) {
  const token = jwt.sign(
    { userId: user.id, role: user.role, tv: user.token_version || 0 },
    SECRET,
    { expiresIn: TOKEN_TTL }
  );
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure:   req.secure,          // true detrás de Caddy (HTTPS); false en local http
    maxAge:   8 * 60 * 60 * 1000,  // 8 horas
  });
}

// -------------------------------------------------------------
// requireAuth — Verifica el JWT de la cookie 'token'
// -------------------------------------------------------------
function requireAuth(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'No autenticado. Inicia sesión.' });
  }

  try {
    // Verificar y decodificar el token
    const payload = jwt.verify(token, SECRET);

    // Comprobar en la BD que el usuario sigue activo y que la sesión no ha
    // sido invalidada (cambio de contraseña → token_version distinto)
    const u = db.prepare(
      'SELECT activo, role, token_version FROM users WHERE id = ?'
    ).get(payload.userId);
    if (!u || !u.activo || (u.token_version || 0) !== (payload.tv || 0)) {
      res.clearCookie('token');
      return res.status(401).json({ error: 'Sesión no válida. Vuelve a iniciar sesión.' });
    }

    // Los ciclos se leen de la BD en cada petición: si el admin cambia
    // las asignaciones, el docente las ve sin volver a iniciar sesión
    const cicloIds = db.prepare(
      'SELECT ciclo_id FROM user_ciclos WHERE user_id = ?'
    ).all(payload.userId).map(r => r.ciclo_id);

    req.user = {
      id:       payload.userId,
      role:     u.role,
      cicloIds,
      cicloId:  cicloIds[0] || null, // compatibilidad
    };

    next();
  } catch (err) {
    // Token inválido o expirado
    return res.status(401).json({ error: 'Sesión expirada. Vuelve a iniciar sesión.' });
  }
}

// -------------------------------------------------------------
// requireAdmin — Exige que el usuario autenticado sea admin
// -------------------------------------------------------------
function requireAdmin(req, res, next) {
  // Primero verificar que está autenticado
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acceso restringido a administradores.' });
    }
    next();
  });
}

module.exports = { requireAuth, requireAdmin, issueSession };
