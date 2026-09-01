# ---------- stage 1: build the PWA ----------
FROM node:22-alpine AS web

WORKDIR /build
# Copy manifests first so this layer caches until dependencies actually change.
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- stage 2: runtime ----------
FROM node:22-alpine

ENV NODE_ENV=production
# The server resolves the built PWA at ../../web/dist relative to its own src/,
# so the container keeps the same layout as the repo.
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/src ./src
COPY --from=web /build/dist /app/web/dist

# Token and stop caches live here; mount a volume so they survive a restart
# instead of re-scraping every city on boot.
ENV CACHE_DIR=/data
RUN mkdir -p /data && chown -R node:node /data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "src/index.js"]
