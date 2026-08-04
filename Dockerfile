# Ядро для проверки конфига (`xray run -test`). Версия совпадает с той, что
# использует Remnawave: проверять конфиг чужим ядром бессмысленно. sha256 взят
# из соответствующего .dgst того же релиза; при смене версии двигать все ARG.
FROM alpine:3.24 AS xray
# Подставляет buildx: amd64 или arm64. Архив и его контрольная сумма
# выбираются парой — рассинхрон здесь тише всего ломает сборку.
ARG TARGETARCH
ARG XRAY_VERSION=v26.7.28
ARG XRAY_SHA256_AMD64=8195d909f1109b8f3d99eefe401a3c451d7bf4af71f24d3815420f77e5dd2a40
ARG XRAY_SHA256_ARM64=f5698bb218ada3b4022db26fafc39601c5f53b46b19eb76c9616325985807501
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) asset=Xray-linux-64.zip;        sha="$XRAY_SHA256_AMD64" ;; \
      arm64) asset=Xray-linux-arm64-v8a.zip; sha="$XRAY_SHA256_ARM64" ;; \
      *) echo "неподдерживаемая архитектура: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    apk add --no-cache curl unzip; \
    curl -fsSL -o /tmp/xray.zip \
      "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/${asset}"; \
    echo "${sha}  /tmp/xray.zip" | sha256sum -c -; \
    unzip -j /tmp/xray.zip xray -d /usr/local/bin; \
    chmod +x /usr/local/bin/xray; \
    rm /tmp/xray.zip

FROM node:24-alpine AS backend-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci --workspace backend
COPY backend backend
RUN npm run build --workspace backend

FROM node:24-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
RUN npm ci --workspace frontend
COPY frontend frontend
RUN npm run build --workspace frontend

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV STATIC_DIR=/app/frontend/dist
ENV XRAY_BIN=/usr/local/bin/xray
COPY --from=xray /usr/local/bin/xray /usr/local/bin/xray
COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci --workspace backend --omit=dev
COPY --from=backend-build /app/backend/dist backend/dist
COPY --from=frontend-build /app/frontend/dist frontend/dist
# Каталог данных создаётся здесь с правильным владельцем: Docker копирует
# права из образа в свежий именованный том, поэтому chown руками не нужен.
RUN mkdir -p /data && chown node:node /data
WORKDIR /app/backend
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
