# 📋 Programaciones Didácticas FP — Aragón

Herramienta web multiusuario para que los docentes de **Formación Profesional** creen, gestionen y exporten sus **programaciones didácticas**, con importación automática de datos desde [CATEDU](https://centrosdocentes.catedu.es) y control centralizado de contenidos por parte del equipo directivo.

---

## ✨ Características principales

### Para el docente
- **Crear programaciones** por módulo con todos los apartados reglamentarios (introducción, RAs, criterios de evaluación, secuenciación, instrumentos, atención a la diversidad, etc.)
- **Importación automática desde CATEDU** — en el momento de crear una programación el docente navega por Familia Profesional → Ciclo Formativo → Módulo y la herramienta rellena automáticamente:
  - Denominación y código del módulo
  - Horas semanales y horas totales del curso
  - Ciclo formativo
  - Resultados de Aprendizaje (RAs)
  - Criterios de Evaluación (CEs) codificados
- **Exportar a PDF y Word** la programación terminada
- **Ver las programaciones** de compañeros del mismo ciclo en modo solo lectura
- Editor de texto enriquecido (negrita, cursiva, listas, checklists) en los campos de desarrollo libre

### Para el administrador
- **Panel de administración** con pestañas:
  - 👨‍🏫 **Docentes y seguridad** — crear, editar, activar/desactivar y eliminar cuentas de docentes
  - 🔄 **Perfiles de ciclo** — crear un perfil por ciclo formativo (IFC201, FPB121, etc.)
  - 🔒 **Campos bloqueados** — fijar y bloquear el contenido de cualquier campo por perfil de ciclo (p. ej. el RD de título, normativa de Aragón, datos del centro) de forma que los docentes los vean pero no puedan modificarlos
- Cada **perfil de ciclo** puede tener sus propios valores bloqueados distintos de los de otros ciclos
- Los campos bloqueados se aplican automáticamente al abrir cualquier programación del ciclo correspondiente

---

## 🏗 Arquitectura

```
programaciones-fp/
├── docker-compose.yml          # Orquestación: backend + frontend (Nginx)
├── backend/
│   ├── Dockerfile
│   ├── server.js               # API REST con Express.js
│   ├── db.js                   # SQLite con better-sqlite3 (tablas + admin inicial)
│   ├── middleware/
│   │   └── auth.js             # JWT en cookie httpOnly (requireAuth / requireAdmin)
│   └── routes/
│       ├── auth.js             # POST /login, POST /logout, GET /me
│       ├── users.js            # CRUD docentes (solo admin)
│       ├── profiles.js         # CRUD perfiles de ciclo y campos bloqueados
│       └── modules.js          # CRUD programaciones con control de permisos
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf              # Proxy /api/* → backend; estáticos → HTML
│   └── index.html              # SPA — toda la aplicación en un único fichero HTML
└── data/
    └── db.sqlite               # Base de datos (volumen Docker, NO en git)
```

**Stack:** Node.js · Express · SQLite · Nginx · Docker

---

## 🚀 Instalación y arranque

### Requisitos
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows / macOS)
- Docker Engine + docker-compose (Linux)

### Primer arranque

```bash
# 1. Clonar o descomprimir el proyecto
git clone https://github.com/tu-usuario/programaciones-fp.git
cd programaciones-fp

# 2. (Opcional) Cambiar contraseña y secreto JWT antes de arrancar
#    Edita docker-compose.yml y modifica las variables de entorno

# 3. Construir imágenes y arrancar
docker-compose up -d --build
```

La aplicación queda disponible en **http://localhost:3000**

### Arranques posteriores

```bash
docker-compose up -d
```

---

## 🔐 Credenciales iniciales

| Usuario | Contraseña |
|---------|------------|
| `admin` | `admin1234` |

> ⚠️ **Cambia la contraseña del admin** en el Panel de Administración → pestaña *Docentes y seguridad* tras el primer login.

Para cambiar las credenciales antes del primer arranque, edita `docker-compose.yml`:

```yaml
environment:
  - ADMIN_PASSWORD=contraseña_segura_aqui
  - JWT_SECRET=cadena_larga_aleatoria_aqui
```

---

## 👣 Flujo de uso recomendado

### 1. Configuración inicial (admin)

1. Entra en **http://localhost:3000** con `admin / admin1234`
2. Abre el **Panel de administración** (botón ⚙ arriba a la derecha)
3. En la pestaña **🔄 Perfiles de ciclo**: crea un perfil por cada ciclo del centro (p. ej. `IFC201 — Sistemas Microinformáticos y Redes`)
4. En la pestaña **🔒 Campos bloqueados**: selecciona el ciclo, activa los candados en los campos que deben ser iguales para todos los docentes de ese ciclo (normativa, datos del centro, etc.) y escribe el texto fijo
5. En la pestaña **👨‍🏫 Docentes**: crea las cuentas de cada docente y asígnales su ciclo

### 2. Crear una programación (docente)

1. Inicia sesión con las credenciales proporcionadas por el admin
2. Pulsa **+ Crear nueva programación**
3. Pulsa **🔍 Buscar módulo** para importar datos desde CATEDU:
   - Selecciona Familia Profesional → Ciclo → Módulo
   - Pulsa **⬇ Cargar RAs desde CATEDU** para importar RAs y CEs
   - Pulsa **✔ Rellenar datos** — se autocompletan nombre, código, horas, ciclo, RAs y CEs
4. Introduce el curso académico y pulsa **Crear módulo**
5. Completa los apartados del formulario y guarda con **💾 Guardar configuración**
6. Exporta a **PDF** o **Word** cuando esté lista

---

## 🔒 Permisos

| Acción | Admin | Docente (mismo ciclo) | Docente (otro ciclo) |
|--------|:-----:|:---------------------:|:--------------------:|
| Ver programaciones propias | ✅ | ✅ | ✅ |
| Editar programaciones propias | ✅ | ✅ | ❌ |
| Ver programaciones del mismo ciclo | ✅ | 👁 solo lectura | ❌ |
| Editar programaciones de otros | ✅ | ❌ | ❌ |
| Gestionar docentes y perfiles | ✅ | ❌ | ❌ |
| Bloquear campos por ciclo | ✅ | ❌ | ❌ |

---

## 💾 Copia de seguridad

Los datos se guardan en `./data/db.sqlite` (fuera del contenedor). Para hacer backup:

```bash
cp data/db.sqlite backups/db_$(date +%Y%m%d_%H%M).sqlite
```

También puedes exportar desde la propia app con el menú **🗄 Datos → Exportar copia de seguridad (.json)**.

---

## 🛠 Comandos útiles

```bash
# Ver logs en tiempo real
docker-compose logs -f

# Solo logs del backend
docker-compose logs -f backend

# Parar sin borrar datos
docker-compose down

# Parar y eliminar imágenes (los datos en ./data persisten)
docker-compose down --rmi all

# Actualizar solo el frontend sin rebuild completo
docker cp frontend/index.html pd_frontend:/usr/share/nginx/html/index.html

# Acceder al backend para depuración
docker exec -it pd_backend sh
```

---

## 🌐 Importación desde CATEDU

La herramienta se conecta al portal de centros docentes de Aragón ([centrosdocentes.catedu.es](https://centrosdocentes.catedu.es)) para importar automáticamente:

- La lista de **Familias Profesionales** y sus **Ciclos Formativos**
- Los **módulos** de cada ciclo con código, nombre y horas
- Los **Resultados de Aprendizaje** y sus **Criterios de Evaluación** oficiales

La conexión se realiza mediante proxies CORS públicos o, si tienes instalada la extensión [CORS Unblock](https://chrome.google.com/webstore/detail/cors-unblock/lfhmikememgdcahcdlaciloancbhjino), directamente desde el navegador.

---

## 📄 Licencia

MIT — libre para uso, modificación y distribución.
