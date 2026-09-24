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
const db      = require('../db');
const { requireAuth, issueSession } = require('../middleware/auth');

const router = express.Router();

// Duración del token: 8 horas (sesión de trabajo normal)
// -------------------------------------------------------------
// Límite de intentos de login (en memoria)
// En 15 min: 5 fallos por IP+usuario, 15 por usuario (cualquier IP) o
// 50 por IP (alto porque todo el centro sale por la misma IP pública)
// → bloqueo hasta que pasen los 15 min
// -------------------------------------------------------------
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IPUSER = 5, MAX_PER_USER = 15, MAX_PER_IP = 50;
const failures = new Map(); // key → { count, first }

function hit(key) {
  const now = Date.now();
  const f = failures.get(key);
  if (!f || now - f.first > WINDOW_MS) failures.set(key, { count: 1, first: now });
  else f.count++;
}
function blocked(key, max) {
  const f = failures.get(key);
  if (!f) return 0;
  const left = WINDOW_MS - (Date.now() - f.first);
  if (left <= 0) { failures.delete(key); return 0; }
  return f.count >= max ? left : 0;
}
// Limpieza periódica para que el Map no crezca
setInterval(() => {
  const now = Date.now();
  for (const [k, f] of failures) if (now - f.first > WINDOW_MS) failures.delete(k);
}, WINDOW_MS).unref();

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

  const ipKey   = `ip:${req.ip}`;
  const uname   = String(username).toLowerCase();
  const userKey = `iu:${req.ip}:${uname}`;
  const nameKey = `u:${uname}`;
  const wait = Math.max(
    blocked(ipKey, MAX_PER_IP), blocked(userKey, MAX_PER_IPUSER), blocked(nameKey, MAX_PER_USER)
  );
  if (wait) {
    db.audit(req, 'login.bloqueado', null, null, null, { id: null, username: uname });
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Prueba de nuevo en ${Math.ceil(wait / 60000)} min.`
    });
  }

  // Buscar el usuario en la BD (también traemos el código del ciclo para el frontend)
  const user = db.prepare(`
    SELECT u.*, cp.cod AS cicloCod, cp.nombre AS cicloNombre
    FROM users u
    LEFT JOIN ciclo_profiles cp ON cp.id = u.ciclo_id
    WHERE u.username = ?
  `).get(username);

  if (!user) {
    // Mismo mensaje para usuario no encontrado y contraseña incorrecta
    // (evitar enumerar usuarios)
    hit(ipKey); hit(userKey); hit(nameKey);
    db.audit(req, 'login.fallido', null, null, 'usuario inexistente', { id: null, username: uname });
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  // Verificar contraseña contra el hash almacenado
  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    hit(ipKey); hit(userKey); hit(nameKey);
    db.audit(req, 'login.fallido', null, null, 'contraseña incorrecta', { id: user.id, username: user.username });
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  // Cuenta desactivada: solo se informa si la contraseña es correcta
  // (así no se revela qué cuentas existen)
  if (!user.activo) {
    db.audit(req, 'login.inactivo', null, null, null, { id: user.id, username: user.username });
    return res.status(403).json({
      error: 'Tu cuenta está desactivada. Si vuelves a trabajar en el centro, pide al jefe de departamento que la reactive: tus programaciones siguen guardadas.'
    });
  }

  // Login correcto: limpiar contador y abrir sesión (JWT en cookie httpOnly)
  failures.delete(userKey);
  failures.delete(nameKey);
  issueSession(req, res, user);
  db.audit(req, 'login.ok', null, null, null, { id: user.id, username: user.username });

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
      ciclos:      db.getUserCiclos(user.id),
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

  res.json({ user: { ...user, cicloId: user.ciclo_id, ciclos: db.getUserCiclos(user.id) } });
});

module.exports = router;
