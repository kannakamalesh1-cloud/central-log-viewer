# Build Stage
FROM node:20 AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Force rebuild native modules for the container environment
RUN npm rebuild sqlite3 --build-from-source

# Build Next.js app
RUN npm run build

# Production Stage
FROM node:20 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Install Docker CLI to support the real-time event watcher
RUN apt-get update && apt-get install -y docker.io && rm -rf /var/lib/apt/lists/*

# Copy built assets and production dependencies
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.js ./
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/data ./data
COPY --from=builder /app/log-wrapper.sh ./

# Create data directory if it doesn't exist
RUN mkdir -p data/backups

EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
