# =============================================================
# backend/Dockerfile
#
# Node.js Alpine. Dependencias fijadas con package-lock.json (npm ci)
# y el proceso corre como usuario sin privilegios "node".
# El entrypoint ajusta el propietario de /app/data (volumen del host)
# y después baja privilegios con su-exec.
# =============================================================

FROM node:20-alpine

# su-exec: cambiar de root a "node" en el arranque
RUN apk add --no-cache su-exec

WORKDIR /app

# Dependencias primero (caché de capas); versiones exactas del lockfile
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Código fuente
COPY . .
RUN chmod +x docker-entrypoint.sh && chown -R node:node /app

ENV NODE_ENV=production
EXPOSE 3001

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
