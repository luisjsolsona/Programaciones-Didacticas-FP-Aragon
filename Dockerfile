# Programaciones Didácticas FP — Aragón

Aplicación web para crear y gestionar programaciones didácticas de Formación Profesional.

## Arquitectura

```
programaciones-fp/
├── docker-compose.yml        # Orquestación de servicios
├── backend/
│   ├── Dockerfile
│   ├── server.js             # Punto de entrada Express
│   ├── db.js                 # SQLite: tablas y usuario admin inicial
│   ├── middleware/
│   │   └── auth.js           # Verificación JWT (requireAuth, requireAdmin)
│   └── routes/
│       ├── auth.js           # Login / logout / me
│       ├── users.js          # CRUD docentes (admin)
│       ├── profiles.js       # CRUD perfiles de ciclo (admin)
│       └── modules.js        # CRUD programaciones didácticas
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf            # Proxy /api/ → backend, estáticos → HTML
│   ├── index.html            # Aplicación principal
│   └── api.js                # Cliente fetch que sustituye localStorage
└── data/
    └── db.sqlite             # Base de datos (generada al arrancar, NO en git)
```

## Requisitos

- Docker Desktop (Windows/Mac) o Docker Engine + docker-compose (Linux)

## Arrancar la aplicación

```bash
# Clonar / descomprimir el proyecto
cd programaciones-fp

# Primer arranque (construye las imágenes)
docker-compose up -d --build

# Arranques posteriores
docker-compose up -d
```

La aplicación queda disponible en **http://localhost:3000**

## Credenciales iniciales

| Usuario | Contraseña |
|---------|-----------|
| admin   | admin1234  |

> ⚠️ Cambia la contraseña del admin tras el primer login.

## Cambiar la contraseña del admin por defecto

Edita `docker-compose.yml` antes del primer arranque:

```yaml
environment:
  - ADMIN_PASSWORD=tu_nueva_contraseña_segura
  - JWT_SECRET=un_secreto_largo_y_aleatorio
```

## Gestión de docentes (desde el panel admin)

1. Crear los perfiles de ciclo (IFC201, FPB121, etc.) con sus campos bloqueados
2. Crear los docentes y asignarles su ciclo
3. Los docentes inician sesión y solo ven / editan sus propias programaciones
4. Pueden ver (solo lectura) las programaciones de compañeros del mismo ciclo

## Backup de datos

Los datos se guardan en `./data/db.sqlite`. Para hacer backup:

```bash
# Copiar la BD a una ubicación segura
cp data/db.sqlite backup/db_$(date +%Y%m%d).sqlite
```

## Parar / eliminar

```bash
# Parar sin borrar datos
docker-compose down

# Parar y borrar imágenes (los datos en ./data persisten)
docker-compose down --rmi all
```

## Logs

```bash
# Ver logs en tiempo real
docker-compose logs -f

# Solo backend
docker-compose logs -f backend
```
