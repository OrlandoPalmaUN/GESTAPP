FROM node:20-alpine
RUN npm install -g pnpm@9

WORKDIR /app

# Copiar manifests
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/api ./apps/api

# Install
RUN pnpm install --frozen-lockfile

# Build API
RUN pnpm --filter @antigravity/api build

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "apps/api/dist/server.js"]
