// =============================================================
// frontend/api.js — Cliente de la API REST
//
// Centraliza todas las llamadas fetch al backend.
// Todas las funciones son async y devuelven los datos o lanzan
// un Error con el mensaje del servidor.
//
// Este fichero sustituye la lógica de localStorage del HTML
// original. Se incluye como <script src="api.js"> en el HTML.
//
// Módulos:
//   Auth     — login, logout, me
//   Users    — CRUD de docentes (admin)
//   Profiles — CRUD de perfiles de ciclo (admin)
//   Modules  — CRUD de programaciones didácticas
// =============================================================

// Helper interno: ejecuta un fetch y lanza error si no es OK
async function apiFetch(path, options = {}) {
  const res = await fetch('/api' + path, {
    credentials: 'include',          // Enviar la cookie JWT siempre
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(json.error || `Error ${res.status}`);
  }

  return json;
}

// =============================================================
// AUTH
// =============================================================
const Auth = {
  // Iniciar sesión — devuelve { user }
  login: (username, password) =>
    apiFetch('/auth/login', { method: 'POST', body: { username, password } }),

  // Cerrar sesión
  logout: () =>
    apiFetch('/auth/logout', { method: 'POST' }),

  // Obtener usuario autenticado (para restaurar sesión al recargar)
  // Devuelve { user } o lanza 401 si no hay sesión activa
  me: () =>
    apiFetch('/auth/me'),
};

// =============================================================
// USERS (solo admin)
// =============================================================
const Users = {
  // Listar todos los docentes
  list: () =>
    apiFetch('/users'),

  // Crear docente — body: { username, password, nombre, cicloIds }
  // cicloIds: array de IDs de ciclo_profiles (puede estar vacío)
  create: (body) =>
    apiFetch('/users', { method: 'POST', body }),

  // Obtener un docente por id
  get: (id) =>
    apiFetch(`/users/${id}`),

  // Editar docente — body: { nombre?, cicloIds?, activo? }
  // cicloIds reemplaza la asignación completa de ciclos del usuario
  update: (id, body) =>
    apiFetch(`/users/${id}`, { method: 'PUT', body }),

  // Eliminar docente
  delete: (id) =>
    apiFetch(`/users/${id}`, { method: 'DELETE' }),

  // Cambiar contraseña — body: { currentPassword?, newPassword }
  changePassword: (id, body) =>
    apiFetch(`/users/${id}/password`, { method: 'PUT', body }),
};

// =============================================================
// PROFILES — Perfiles de ciclo formativo
// =============================================================
const Profiles = {
  // Listar todos los perfiles
  list: () =>
    apiFetch('/profiles'),

  // Crear perfil — body: { cod, nombre, locked_fields }
  create: (body) =>
    apiFetch('/profiles', { method: 'POST', body }),

  // Obtener perfil por id
  get: (id) =>
    apiFetch(`/profiles/${id}`),

  // Editar perfil — body: { nombre?, locked_fields? }
  update: (id, body) =>
    apiFetch(`/profiles/${id}`, { method: 'PUT', body }),

  // Eliminar perfil
  delete: (id) =>
    apiFetch(`/profiles/${id}`, { method: 'DELETE' }),
};

// =============================================================
// BACKUP — Copia de seguridad completa (solo admin)
// =============================================================
const Backup = {
  // Exportar todo: perfiles, usuarios (sin contraseñas) y módulos
  export: () =>
    apiFetch('/backup'),

  // Restaurar desde backup v3
  // body: { profiles, users, modules, defaultPassword? }
  restore: (body) =>
    apiFetch('/backup/restore', { method: 'POST', body }),
};

// =============================================================
// MODULES — Programaciones didácticas
// =============================================================
const Modules = {
  // Listar programaciones visibles para el usuario actual
  list: () =>
    apiFetch('/modules'),

  // Crear programación — body: { titulo, codigo, data, cicloId? }
  create: (body) =>
    apiFetch('/modules', { method: 'POST', body }),

  // Obtener programación completa (con lockedKeys y readOnly)
  get: (id) =>
    apiFetch(`/modules/${id}`),

  // Guardar cambios — body: { titulo?, codigo?, data? }
  // Los campos bloqueados del ciclo se sobreescriben en el servidor
  update: (id, body) =>
    apiFetch(`/modules/${id}`, { method: 'PUT', body }),

  // Eliminar programación
  delete: (id) =>
    apiFetch(`/modules/${id}`, { method: 'DELETE' }),
};
