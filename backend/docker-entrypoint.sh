#!/bin/sh
# Asegura que el volumen de datos pertenece a "node" y arranca sin root
set -e
mkdir -p /app/data/backups
chown -R node:node /app/data
exec su-exec node "$@"
