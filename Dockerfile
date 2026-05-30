FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
 && rm -rf /var/lib/apt/lists/*

RUN npm install --build-from-source

COPY . .

RUN npm run build


# Production Stage
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

RUN apt-get update && apt-get install -y \
    docker.io \
    python3 \
    make \
    g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install --omit=dev --build-from-source

# Copy Next.js build output
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# IMPORTANT FIX: ensure Next runtime works with custom server
COPY --from=builder /app/server.js ./
COPY --from=builder /app/key.pem /app/cert.pem ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/data ./data
COPY --from=builder /app/log-wrapper.* ./

# Ensure Next.js required runtime files exist
COPY --from=builder /app/next.config.* ./

RUN mkdir -p data/backups

EXPOSE 3000

# FIX: ensure environment uses production Next.js correctly
ENV NEXT_TELEMETRY_DISABLED=1

# IMPORTANT: keep your server.js (no structural change)
CMD ["node", "server.js"]
