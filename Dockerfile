# Production Dockerfile for SYT Health Check App
FROM node:20-alpine

# Set Timezone to Vietnam (Asia/Ho_Chi_Minh)
RUN apk add --no-cache tzdata
ENV TZ=Asia/Ho_Chi_Minh

# Set working directory
WORKDIR /usr/src/app

# Copy dependency definition
COPY --chown=node:node package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source code
COPY --chown=node:node . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose app port
EXPOSE 3000

# Health check using the existing /ping route
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ping || exit 1

# Run as non-root user
USER node

# Start server directly for optimal signal handling (SIGTERM / SIGINT)
CMD ["node", "src/server.js"]
