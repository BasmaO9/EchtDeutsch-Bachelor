# Use Node.js LTS version as base image
FROM node:20-slim

# Install Python 3 and build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files FIRST (for Docker cache)
COPY package*.json ./

# Copy NestJS config files BEFORE npm ci
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Install all Node.js dependencies (postinstall can now run safely)
RUN npm ci

# Copy the rest of the source code
COPY . .

RUN python3 -m venv python-scripts/venv && \
    python-scripts/venv/bin/pip install --upgrade pip && \
    python-scripts/venv/bin/pip install --no-cache-dir -r python-scripts/requirements.txt && \
    python-scripts/venv/bin/python -m spacy download de_core_news_sm

# Build NestJS application
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Expose port
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Start the application
CMD ["npm", "run", "start:prod"]
