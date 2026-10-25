# Multi-stage Dockerfile for RoadWatch AI on PieHost / Cloud Container Hosting

# Stage 1: Build Vite frontend and bundled server
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Minimal Production Runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev

# Copy production assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js

# Use non-root node user for container security
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
