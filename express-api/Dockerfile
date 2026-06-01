FROM node:18-bullseye-slim
WORKDIR /app

# Install minimal build deps so native modules (if any) can compile during npm install
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 build-essential ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
# prefer npm ci when a lockfile exists for reproducible installs
RUN npm config set fund false && npm config set audit false
# Use unsafe-perm to avoid permission issues during native builds; fall back to npm install
RUN if [ -f package-lock.json ]; then npm ci --production --unsafe-perm --no-audit --no-fund; else npm install --production --unsafe-perm --no-audit --no-fund; fi

COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
