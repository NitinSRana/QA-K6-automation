FROM node:22-alpine

# Install k6 directly so we don't need Docker-in-Docker inside the container.
# Also keep docker-cli available for local dev fallback.
RUN apk add --no-cache bash curl docker-cli && \
    K6_VERSION=v0.55.0 && \
    ARCH=$(uname -m) && \
    case "$ARCH" in \
      x86_64)  K6_ARCH=amd64 ;; \
      aarch64) K6_ARCH=arm64 ;; \
      *)       K6_ARCH=amd64 ;; \
    esac && \
    curl -fsSL "https://github.com/grafana/k6/releases/download/${K6_VERSION}/k6-${K6_VERSION}-linux-${K6_ARCH}.tar.gz" \
      | tar -xz --strip-components=1 -C /usr/local/bin k6-${K6_VERSION}-linux-${K6_ARCH}/k6 && \
    chmod +x /usr/local/bin/k6

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY public/ ./public/

RUN mkdir -p scripts/generated uploads

EXPOSE 3000

CMD ["node", "src/server.js"]
