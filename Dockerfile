FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY server.js ./
COPY hlx-stock-system.html ./
COPY stock-checker.html ./
COPY products.json ./

# Create data directory
RUN mkdir -p data backups

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
