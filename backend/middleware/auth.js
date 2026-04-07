// =============================================================
// backend/middleware/auth.js — Middlewares de autenticación
//
// Exporta dos middlewares:
//
//   requireAuth   — Verifica que el JWT en la cookie es válido.
//                   Si no lo es, devuelve 401.
//                   Si es válido, añade req.user = { id, role, cicloId }
//
//   requireAdmin  — Usa requireAuth y además exige role === 'admin'.
//                   Si no es admin, devuelve 403.
//
// Uso en rutas:
//   router.get('/ruta', requireAuth, handler)
//   router.post('/admin-ruta', requireAdmin, handler)
// =============================================================

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'secreto_por_defecto_cambiar';

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

    req.user = {
      id:       payload.userId,
      role:     payload.role,
      cicloIds: payload.cicloIds || [],
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

module.exports = { requireAuth, requireAdmin };
