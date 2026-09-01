# =============================================================
# docker-compose.yml — Orquestación de servicios
#
# Servicios:
#   - backend:  API REST con Express + SQLite (puerto interno 3001)
#   - frontend: Nginx que sirve el HTML y hace proxy a la API
#
# Uso:
#   Arrancar:   docker-compose up -d
#   Detener:    docker-compose down
#   Logs:       docker-compose logs -f
#   Rebuild:    docker-compose up -d --build
#
# La carpeta ./data se monta como volumen para que la base de
# datos SQLite persista aunque el contenedor se elimine.
# =============================================================

services:

  # ── Backend: Express + SQLite ──────────────────────────────
  backend:
    build: ./backend
    container_name: pd_backend
    restart: unless-stopped
    volumes:
      # La BD sqlite se guarda en ./data/db.sqlite (fuera del contenedor)
      - ./data:/app/data
    environment:
      # Secreto para firmar los JWT — CAMBIAR en producción
      - JWT_SECRET=cambia_este_secreto_en_produccion
      # Contraseña inicial del admin (se hashea al arrancar si no existe)
      - ADMIN_PASSWORD=admin1234
      # Puerto en el que escucha Express (interno)
      - PORT=3001
      # Entorno: development | production
      - NODE_ENV=production
    expose:
      - "3001"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  # ── Frontend: Nginx ────────────────────────────────────────
  frontend:
    build: ./frontend
    container_name: pd_frontend
    restart: unless-stopped
    ports:
      # Puerto expuesto al host → acceso en http://localhost:3000
      - "3000:80"
    depends_on:
      - backend
