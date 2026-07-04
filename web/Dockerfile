FROM node:22-slim

WORKDIR /app

# Install dependencies first for caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application files
COPY server.js ./
COPY public/ ./public/

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e " \
    const http = require('http'); \
    const req = http.request('http://localhost:4000/api/auth/check', { timeout: 2000 }, (res) => { \
      process.exit(res.statusCode === 200 ? 0 : 1); \
    }); \
    req.on('error', () => process.exit(1)); \
    req.end(); \
  "

CMD ["node", "server.js"]

