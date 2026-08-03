# syntax=docker/dockerfile:1
#
# Imagen genérica: no asume ningún proveedor de infraestructura. Toda la
# configuración de runtime (PORT, TELEGRAM_*, TIPMINER_*) llega por
# variables de entorno estándar (ver .env.example); nada en este Dockerfile
# depende de dónde se ejecute el contenedor.

ARG NODE_VERSION=22-alpine

# ---- deps: instalación completa (incl. devDependencies, hacen falta para compilar) ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build: TypeScript -> dist/ ----
FROM node:${NODE_VERSION} AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- prod-deps: solo dependencias de producción, para una imagen final liviana ----
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---- runtime: imagen final, sin toolchain de build ----
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER app

# EXPOSE es solo documentación para el runtime de contenedores: el puerto
# real en el que escucha la app lo decide PORT (ver configuration.ts), y
# cualquier plataforma puede mapear el que declare esa variable.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/healthz" || exit 1

CMD ["node", "dist/main.js"]
