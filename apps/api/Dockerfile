FROM node:20-alpine AS base
RUN npm install -g pnpm@9

# ── Instalar deps + build ──────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Copiar manifests primero (layer cache)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/config/package.json  ./packages/config/
COPY packages/shared/package.json  ./packages/shared/
COPY packages/db/package.json      ./packages/db/
COPY apps/api/package.json         ./apps/api/

RUN pnpm install --frozen-lockfile

# Copiar todo el source
COPY packages/config  ./packages/config
COPY packages/shared  ./packages/shared
COPY packages/db      ./packages/db
COPY apps/api         ./apps/api

RUN pnpm --filter @antigravity/api build

# ── Runtime mínimo ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN npm install -g pnpm@9
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/config/package.json  ./packages/config/
COPY packages/shared/package.json  ./packages/shared/
COPY packages/db/package.json      ./packages/db/
COPY apps/api/package.json         ./apps/api/

RUN pnpm install --frozen-lockfile --prod

# Compiled API
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# shared se importa como TS en source pero el API compilado ya tiene todo
# lo que necesita en dist/ — si hay imports residuales del shared en runtime
# se necesita copiar su source también.
COPY packages/shared/src ./packages/shared/src

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "apps/api/dist/server.js"]
