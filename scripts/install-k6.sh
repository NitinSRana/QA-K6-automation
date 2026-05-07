#!/usr/bin/env bash
# Install k6 locally for dev mode (no Docker needed for test execution)
set -e

K6_VERSION="v0.55.0"
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64)  ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

echo "Installing k6 ${K6_VERSION} for ${OS}/${ARCH}..."

if [ "$OS" = "linux" ]; then
  curl -fsSL "https://github.com/grafana/k6/releases/download/${K6_VERSION}/k6-${K6_VERSION}-linux-${ARCH}.tar.gz" \
    | tar -xz --strip-components=1 -C /tmp "k6-${K6_VERSION}-linux-${ARCH}/k6"
  sudo mv /tmp/k6 /usr/local/bin/k6
  chmod +x /usr/local/bin/k6
elif [ "$OS" = "darwin" ]; then
  brew install k6
else
  echo "Windows: download from https://github.com/grafana/k6/releases"
  exit 0
fi

echo "k6 installed: $(k6 version)"
