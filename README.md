# Programaciones Didácticas FP — Aragón

Herramienta web multiusuario para que los docentes de **Formación Profesional** creen, gestionen y exporten sus **programaciones didácticas**, con importación automática de datos desde [CATEDU](https://centrosdocentes.catedu.es) y control centralizado por parte del equipo directivo o jefatura de departamento.

Desarrollada específicamente para el sistema educativo de **Aragón**, adaptada a la normativa vigente (ORDEN ECD/842/2024 y concordantes).

---

## Características generales

- Aplicación web accesible desde cualquier navegador, sin instalación en el equipo del docente
- Arquitectura cliente-servidor: frontend Nginx + backend Express + base de datos SQLite
- Autenticación segura mediante JWT en cookie httpOnly
- Guardado automático con debounce (1,5 s tras cada edición)
- Exportación a **PDF** y **Word**
- Copia de seguridad y restauración en formato JSON
- Compatible con Docker en cualquier plataforma (Linux, Windows, macOS, CasaOS)

---

## Características particulares

### Para el docente
- Crear programaciones didácticas por módulo con todos los apartados reglamentarios (introducción, RAs, secuenciación, metodología, evaluación, atención a la diversidad, recursos, actividades complementarias)
- **Importación automática desde CATEDU**: navega por Familia Profesional → Ciclo → Módulo y se rellenan automáticamente código, horas, RAs y criterios de evaluación codificados (CE1.a, CE1.b…)
- Editor de texto enriquecido en los campos de desarrollo libre
- Vista de solo lectura de las programaciones de compañeros del mismo ciclo

### Crear PERFILES
![crear perfiles](crear-perfiles.gif)

### Crear USUARIOS
![crear usuarios](crear-usuarios.gif)

### BLOQUEAR campos
![Bloquear campos](bloquear_campos.gif)

### CREAR PROGRAMACIONES
![Crear Programaciones](crear-programacion.gif)

### Para el administrador
- Panel de administración con tres pestañas:
  - **Docentes y seguridad** — crear, editar, activar/desactivar y eliminar cuentas; cambiar contraseña del admin
  - **Perfiles de ciclo** — crear un perfil por ciclo formativo; ver campos bloqueados por perfil
  - **Campos bloqueados** — fijar el contenido de cualquier campo por ciclo; los docentes lo ven pero no pueden modificarlo
- El administrador puede ver y editar todas las programaciones de todos los docentes

---

## Instalación y arranque

**Requisitos:** Docker + Docker Compose

```bash
# 1. Clonar el repositorio
git clone https://github.com/luisjsolsona/Programaciones-Didacticas-FP-Aragon.git
cd Programaciones-Didacticas-FP-Aragon

# 2. (Recomendado) Editar docker-compose.yml y cambiar JWT_SECRET y ADMIN_PASSWORD

# 3. Construir y arrancar
docker compose up -d --build
```

Acceder en: **http://localhost:3000**

La base de datos se crea automáticamente en `./data/db.sqlite` en el primer arranque.

```bash
# Arranques posteriores
docker compose up -d

# Ver logs
docker compose logs -f

# Parar
docker compose down

# Actualizar tras git pull
docker compose up -d --build
```

---

## Credenciales por defecto

| Usuario | Contraseña  |
|---------|-------------|
| `admin` | `admin1234` |

> ⚠️ Cambia la contraseña en el Panel de Administración → *Docentes y seguridad* tras el primer login.

Para establecer credenciales propias antes del primer arranque, edita `docker-compose.yml`:

```yaml
environment:
  - ADMIN_PASSWORD=contraseña_segura
  - JWT_SECRET=cadena_larga_y_aleatoria
```

---

## Roles / Permisos

| Acción | Admin | Docente (propio ciclo) | Docente (otro ciclo) |
|--------|:-----:|:----------------------:|:--------------------:|
| Ver sus propias programaciones | ✅ | ✅ | ✅ |
| Editar sus propias programaciones | ✅ | ✅ | ❌ |
| Ver programaciones del mismo ciclo | ✅ | 👁 solo lectura | ❌ |
| Editar programaciones de otros | ✅ | ❌ | ❌ |
| Gestionar docentes y perfiles | ✅ | ❌ | ❌ |
| Bloquear campos por ciclo | ✅ | ❌ | ❌ |

---

## Arquitectura

```
Programaciones-Didacticas-FP-Aragon/
├── docker-compose.yml          # Orquestación: backend + frontend (Nginx)
├── backend/
│   ├── Dockerfile
│   ├── server.js               # API REST Express.js
│   ├── db.js                   # SQLite con better-sqlite3
│   ├── middleware/
│   │   └── auth.js             # JWT httpOnly (requireAuth / requireAdmin)
│   └── routes/
│       ├── auth.js             # POST /login · POST /logout · GET /me
│       ├── users.js            # CRUD docentes (solo admin)
│       ├── profiles.js         # CRUD perfiles de ciclo y campos bloqueados
│       └── modules.js          # CRUD programaciones
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf              # Proxy /api/* → backend
│   ├── icon.svg                # Icono de la aplicación
│   └── index.html              # SPA completa en un único fichero
└── data/
    └── db.sqlite               # Base de datos (generada al arrancar, persistente)
```

**Stack:** Node.js · Express · SQLite · Nginx · Docker

---

## Despliegue en CasaOS

1. Clona el repositorio en tu servidor CasaOS:
   ```bash
   git clone https://github.com/luisjsolsona/Programaciones-Didacticas-FP-Aragon.git
   ```
2. En la UI de CasaOS ve a **App Store → Custom Install → Import docker-compose**
3. Selecciona el fichero `docker-compose.yml` del repositorio clonado
4. CasaOS detectará automáticamente el nombre, descripción e icono de la app
5. Accede en `http://<ip-casaos>:3000`

> ⚠️ Cambia `JWT_SECRET` y `ADMIN_PASSWORD` en `docker-compose.yml` antes de arrancar en producción.
