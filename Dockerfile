# oc-crm-engine — Multi-stage Docker build
# Build:  docker build -t oc-crm-engine .
# Run:    docker run -p 3001:3001 --env-file .env oc-crm-engine

# --- Stage 1: Build ---
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# --- Stage 2: Production ---
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 crmengine

COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

USER crmengine

EXPOSE 3001

CMD ["node", "dist/index.js"]
