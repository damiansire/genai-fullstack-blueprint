# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package configurations
COPY package*.json ./
COPY packages/api/package*.json ./packages/api/
COPY packages/client/package*.json ./packages/client/

# Install dependencies (since we are zero-deps as much as possible, this is fast)
RUN npm ci --workspace=packages/api

# Copy source code
COPY packages/api/ ./packages/api/

# Build TypeScript
RUN npm run build --workspace=packages/api

# Stage 2: Production (Distroless / Lightweight Alpine)
FROM node:22-alpine AS production

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy compiled code and production dependencies
COPY --from=builder /app/packages/api/dist ./dist
COPY --from=builder /app/packages/api/package.json ./package.json

# Install only production dependencies
# Since we use built-ins (sqlite-vec via native, crypto, tests), this footprint is tiny
RUN npm install --omit=dev

# Cloud Run injects the PORT dynamically
ENV PORT=8080
EXPOSE 8080

# Run with Node native env config
# We assume .env is injected via Cloud Run secrets manager, or mapped
CMD ["node", "dist/server.js"]
