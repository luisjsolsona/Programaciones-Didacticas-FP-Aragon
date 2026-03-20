# =============================================================
# backend/Dockerfile
#
# Imagen Node.js Alpine (ligera) para el servidor Express.
# Instala dependencias, copia el código y arranca el servidor.
# =============================================================

FROM node:20-alpine

# Directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiar solo package.json primero para aprovechar la caché de
# capas de Docker (las dependencias no se reinstalan si no cambia)
COPY package*.json ./

# Instalar dependencias de producción únicamente
RUN npm install --omit=dev

# Copiar el resto del código fuente
COPY . .

# Puerto que expone el contenedor (debe coincidir con PORT en .env)
EXPOSE 3001

# Comando de arranque
CMD ["node", "server.js"]
