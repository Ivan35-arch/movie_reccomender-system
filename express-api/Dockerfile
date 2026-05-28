FROM node:20-alpine

WORKDIR /app

# Install curl for Docker healthcheck
RUN apk add --no-cache curl

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
