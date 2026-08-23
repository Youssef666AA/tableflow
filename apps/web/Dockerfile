# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- builder
FROM node:22-alpine AS builder
WORKDIR /repo

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY packages/shared packages/shared
COPY apps/web apps/web

# Empty API base: nginx serves the app and the API from the same origin,
# so the browser never makes a cross-origin request and CORS never applies.
ENV VITE_API_URL=""
RUN npm run build -w @tableflow/shared \
 && npm run build -w @tableflow/web

# ---------------------------------------------------------------- runtime
FROM nginx:1.27-alpine AS runtime
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

HEALTHCHECK --interval=20s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
