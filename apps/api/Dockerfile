# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- builder
FROM node:22-alpine AS builder
WORKDIR /repo

# Install with the full workspace manifest set so npm can resolve the links.
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=optional=false

COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npm run build -w @tableflow/shared \
 && npm run db:generate -w @tableflow/api \
 && npm run build -w @tableflow/api

# Drop everything the runtime does not need.
RUN npm prune --omit=dev --workspaces --include-workspace-root

# ---------------------------------------------------------------- runtime
FROM node:22-alpine AS runtime
WORKDIR /repo

ENV NODE_ENV=production
# Prisma needs OpenSSL, and tini gives us correct signal handling for graceful shutdown.
RUN apk add --no-cache openssl tini

COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/package.json ./package.json
COPY --from=builder /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /repo/packages/shared/dist ./packages/shared/dist
COPY --from=builder /repo/apps/api/package.json ./apps/api/package.json
COPY --from=builder /repo/apps/api/dist ./apps/api/dist
COPY --from=builder /repo/apps/api/prisma ./apps/api/prisma
COPY --from=builder /repo/apps/api/node_modules ./apps/api/node_modules

USER node
WORKDIR /repo/apps/api
EXPOSE 4000

HEALTHCHECK --interval=20s --timeout=5s --start-period=25s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
