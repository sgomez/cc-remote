FROM node:22-slim

WORKDIR /app

# Install dependencies first for caching
COPY package.json ./
RUN npm install --production

# Copy application files
COPY server.js ./
COPY public/ ./public/

EXPOSE 4000

CMD ["node", "server.js"]
