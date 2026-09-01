// =============================================================
// backend/routes/auth.js — Autenticación
//
// Rutas:
//   POST /api/auth/login   — Valida credenciales, devuelve JWT en cookie
//   POST /api/auth/logout  — Borra la cookie del JWT
//   GET  /api/auth/me      — Devuelve los datos del usuario autenticado
//
// El JWT se almacena en una cookie httpOnly para evitar que
// JavaScript del frontend pueda leerla (protección XSS).
// =============================================================

const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'secreto_por_defecto_cambiar';

// Duración del token: 8 horas (sesión de trabajo normal)
const TOKEN_TTL = '8h';

// =============================================================
// POST /api/auth/login
// Body: { username, password }
// Respuesta: { user: { id, username, role, cicloId, nombre } }
// =============================================================
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
  }

  // Buscar el usuario en la BD (también traemos el código del ciclo para el frontend)
  const user = db.prepare(`
    SELECT u.*, cp.cod AS cicloCod, cp.nombre AS cicloNombre
    FROM users u
    LEFT JOIN ciclo_profiles cp ON cp.id = u.ciclo_id
    WHERE u.username = ? AND u.activo = 1
  `).get(username);

  if (!user) {
    // Mismo mensaje para usuario no encontrado y contraseña incorrecta
    // (evitar enumerar usuarios)
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  // Verificar contraseña contra el hash almacenado
  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  // Generar JWT con los datos mínimos necesarios
  const token = jwt.sign(
    {
      userId:  user.id,
      role:    user.role,
      cicloId: user.ciclo_id || null,
    },
    SECRET,
    { expiresIn: TOKEN_TTL }
  );

  // Guardar el JWT en una cookie httpOnly (no accesible desde JS del frontend)
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    // secure: true,  // Descomentar si usas HTTPS en producción
    maxAge: 8 * 60 * 60 * 1000, // 8 horas en ms
  });

  // Devolver los datos públicos del usuario (sin hash ni datos sensibles)
  res.json({
    user: {
      id:          user.id,
      username:    user.username,
      nombre:      user.nombre,
      role:        user.role,
      cicloId:     user.ciclo_id,
      cicloCod:    user.cicloCod,
      cicloNombre: user.cicloNombre,
    }
  });
});

// =============================================================
// POST /api/auth/logout
// Elimina la cookie del JWT
// =============================================================
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// =============================================================
// GET /api/auth/me
// Devuelve los datos del usuario autenticado (para restaurar
// la sesión al recargar la página sin volver a hacer login)
// =============================================================
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(`
    SELECT u.id, u.username, u.nombre, u.role, u.ciclo_id,
           cp.cod AS cicloCod, cp.nombre AS cicloNombre
    FROM users u
    LEFT JOIN ciclo_profiles cp ON cp.id = u.ciclo_id
    WHERE u.id = ? AND u.activo = 1
  `).get(req.user.id);

  if (!user) {
    // El usuario fue desactivado mientras tenía sesión abierta
    res.clearCookie('token');
    return res.status(401).json({ error: 'Usuario no encontrado o desactivado.' });
  }

  res.json({ user });
});

module.exports = router;
