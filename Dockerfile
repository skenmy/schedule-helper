# ── Build the client ─────────────────────────────────────────────────────────
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:24-slim

# streamlink + ffmpeg grab single frames from Twitch for stream capture; the
# frame is then read by Claude (ANTHROPIC_API_KEY). ca-certificates for TLS.
RUN apt-get update && apt-get install -y --no-install-recommends \
        streamlink \
        ffmpeg \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The server is TypeScript, run directly by Node's built-in type stripping.
COPY src/shared ./src/shared
COPY src/server ./src/server
COPY --from=build /app/dist/client ./dist/client

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    CLIENT_DIR=/app/dist/client \
    NODE_NO_WARNINGS=1

# CI passes the git SHA so open clients can prompt a reload after a deploy.
ARG BUILD_SHA=dev
ENV BUILD_SHA=${BUILD_SHA}

EXPOSE 3000
CMD ["node", "src/server/index.ts"]
