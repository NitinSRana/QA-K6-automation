FROM node:22-alpine

# Install docker CLI (for running k6 containers from within the app)
RUN apk add --no-cache docker-cli

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY public/ ./public/

RUN mkdir -p scripts/generated uploads

EXPOSE 3000

CMD ["node", "src/server.js"]
