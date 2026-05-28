FROM node:22-slim

# System tools required by the stream-OCR pipeline:
#   - streamlink: extracts the live Twitch HLS stream
#   - ffmpeg:     frame capture + preprocessing for OCR
#   - tesseract-ocr: OCR engine
# ca-certificates so streamlink can reach Twitch over TLS.
RUN apt-get update && apt-get install -y --no-install-recommends \
        streamlink \
        ffmpeg \
        tesseract-ocr \
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

EXPOSE 3000

CMD ["node", "server.js"]
