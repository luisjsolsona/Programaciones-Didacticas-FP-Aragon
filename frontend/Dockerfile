# =============================================================
# frontend/Dockerfile
#
# Nginx Alpine para servir el HTML estático y hacer proxy
# inverso hacia el backend para las rutas /api/*.
# =============================================================

FROM nginx:alpine

# Copiar configuración personalizada de Nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copiar el HTML de la aplicación
COPY index.html /usr/share/nginx/html/index.html
COPY icon.svg  /usr/share/nginx/html/icon.svg

EXPOSE 80
