# syntax=docker/dockerfile:1.4

# Etapa 1: Infraestructura de Base de Construcción 
# Empleo mandatario de Debian Slim para garantizar compatibilidad nativa íntegra
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Inicialización del gestor avanzado de librerías base OS.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential && \
    rm -rf /var/lib/apt/lists/*

# Transición perimetral de manifiestos de control y vinculación a nivel de monorepo.
COPY package.json package-lock.json ./
COPY packages/api/package.json ./packages/api/
COPY packages/client/package.json ./packages/client/

# Absorción e hidratación del árbol completo de dependencias cruzadas
# Apalancando con vehemencia un punto de anclaje de caché temporal canalizado por BuildKit.
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Transferencia granular de la algoritmia y código fuente operativo.
COPY packages/api/ ./packages/api/

# Activación del orquestador interno de procesamiento
RUN npm run build --workspace=packages/api

# Operación Quirúrgica: Poda y desvinculación sistémica de pertrechos de desarrollo local
RUN npm prune --omit=dev --workspace=packages/api && \
    npm prune --omit=dev

# Preparación de la carpeta para almacenamiento local de la base de datos
RUN mkdir -p /app/data && chown -R 65532:65532 /app/data

# Etapa 2: Imagen Final Distribuida y Consolidada Minimalista
# Adopción del estándar Distroless para la rama Debian 12 con candado nonroot
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS production

WORKDIR /app

ENV NODE_ENV=production

# Transferencia extractiva del compilado
COPY --from=builder /app/packages/api/dist ./dist
COPY --from=builder /app/packages/api/package.json ./package.json

# Traspaso de la topología pre-podada de directorios de resolución global
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/api/node_modules ./packages/api/node_modules

# Transferencia de la carpeta de datos con privilegios alineados a nonroot (UID 65532)
COPY --from=builder --chown=nonroot:nonroot /app/data ./data
VOLUME ["/app/data"]

ENV PORT=8080
EXPOSE 8080

# Comando vectorial implícito de ejecución.
CMD ["dist/server.js"]
