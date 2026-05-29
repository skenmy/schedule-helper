FROM node:22-slim

# System tools required by the stream-OCR pipeline:
#   - streamlink: extracts the live Twitch HLS stream
#   - ffmpeg:     single-frame capture from the streamlink stdout
# OCR itself runs in the Anthropic API via Claude Vision (see ANTHROPIC_API_KEY).
# ca-certificates so streamlink can reach Twitch over TLS.
RUN apt-get update && apt-get install -y --no-install-recommends \
        streamlink \
        ffmpeg \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY public/ ./public/

ENV NODE_ENV=production
ENV PORT=3000
# Override at runtime to point at the mounted volume
ENV DATA_DIR=/data

# Build-time identity — CI passes the short git SHA so the client can
# detect when a new image has been published and prompt a reload.
ARG BUILD_SHA=dev
ENV BUILD_SHA=${BUILD_SHA}

EXPOSE 3000

CMD ["node", "server.js"]
