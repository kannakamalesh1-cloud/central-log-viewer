# ── Stage 1: Builder ──────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Install native build tools (needed once for ssh2, better-sqlite3, etc.)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
 && rm -rf /var/lib/apt/lists/*

# Copy manifests first — lets Docker cache this layer so npm install
# is only re-run when package.json actually changes.
COPY package*.json ./

# Build ALL deps (including dev) from source — compiled once here.
RUN npm install --build-from-source

# Copy source and build Next.js
COPY . .
RUN npm run build

# Prune devDependencies in-place so runner gets a clean production tree.
RUN npm prune --omit=dev


# ── Stage 2: Runner ───────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# Only docker.io is needed at runtime (for socket + docker commands).
# No python3/make/g++ — we're reusing pre-compiled node_modules from builder.
RUN apt-get update && apt-get install -y \
    docker.io \
 && rm -rf /var/lib/apt/lists/*

# Copy pre-built, pruned node_modules — zero recompilation needed.
COPY --from=builder /app/node_modules ./node_modules

# Copy Next.js production build
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# Copy server and app files
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server.js ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/next.config.* ./
COPY --from=builder /app/log-wrapper.* ./

# Copy TLS certs (ignore if missing — build won't fail)
COPY --from=builder /app/key.pem /app/cert.pem ./

# Ensure data directory exists for SQLite + backups
RUN mkdir -p data/backups

EXPOSE 3000

CMD ["node", "server.js"]
