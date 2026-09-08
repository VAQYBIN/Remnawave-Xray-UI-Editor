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

# Ядро Mihomo для проверки шаблонов подписки (`mihomo -t -f`). Приём тот же, что
# у стадии xray: закреплённая версия и контрольная сумма, архитектура — от buildx.
FROM alpine:3.24 AS mihomo
ARG TARGETARCH
ARG MIHOMO_VERSION=v1.19.30
ARG MIHOMO_SHA256_AMD64=cf06ce2c7d1421bdbda14ee4a5b6046672dc35ebf8eecd8e77504ec3c0ed9a84
ARG MIHOMO_SHA256_ARM64=58896873736d28628f66de3677c8654fa0f180662523148e136cff4f6e890069
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) asset="mihomo-linux-amd64-${MIHOMO_VERSION}.gz"; sha="$MIHOMO_SHA256_AMD64" ;; \
      arm64) asset="mihomo-linux-arm64-${MIHOMO_VERSION}.gz"; sha="$MIHOMO_SHA256_ARM64" ;; \
      *) echo "неподдерживаемая архитектура: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    apk add --no-cache curl; \
    curl -fsSL -o /tmp/mihomo.gz \
      "https://github.com/MetaCubeX/mihomo/releases/download/${MIHOMO_VERSION}/${asset}"; \
    echo "${sha}  /tmp/mihomo.gz" | sha256sum -c -; \
    gunzip -c /tmp/mihomo.gz > /usr/local/bin/mihomo; \
    chmod +x /usr/local/bin/mihomo; \
    rm /tmp/mihomo.gz

# Ядро sing-box для проверки шаблонов подписки (`sing-box check`). Приём тот же, что
# у стадий xray и mihomo: закреплённая версия и контрольная сумма, архитектура — от
# buildx. Архив — musl-сборка, а не «обычная» (glibc): та линкуется с системным
# динамическим загрузчиком, которого в alpine (musl) нет, и не запускается вовсе —
# проверено сборкой обеих архитектур.
FROM alpine:3.24 AS singbox
ARG TARGETARCH
ARG SINGBOX_VERSION=1.13.21
ARG SINGBOX_SHA256_AMD64=8864abb3b72a6b404445a8c25183c79cfa44a80def0d775ac79578e74fb980e7
ARG SINGBOX_SHA256_ARM64=5cf4d77d21101a6f20ada0debb8a137dbb380e2c1e503abc33e1d307216fa9c1
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) asset="sing-box-${SINGBOX_VERSION}-linux-amd64-musl.tar.gz"; sha="$SINGBOX_SHA256_AMD64" ;; \
      arm64) asset="sing-box-${SINGBOX_VERSION}-linux-arm64-musl.tar.gz"; sha="$SINGBOX_SHA256_ARM64" ;; \
      *) echo "неподдерживаемая архитектура: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    apk add --no-cache curl tar; \
    curl -fsSL -o /tmp/sing-box.tar.gz \
      "https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/${asset}"; \
    echo "${sha}  /tmp/sing-box.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/sing-box.tar.gz -C /tmp; \
    mv "/tmp/sing-box-${SINGBOX_VERSION}-linux-${TARGETARCH}-musl/sing-box" /usr/local/bin/sing-box; \
    chmod +x /usr/local/bin/sing-box; \
    rm -rf /tmp/sing-box.tar.gz "/tmp/sing-box-${SINGBOX_VERSION}-linux-${TARGETARCH}-musl"

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
ENV MIHOMO_BIN=/usr/local/bin/mihomo
ENV SINGBOX_BIN=/usr/local/bin/sing-box
COPY --from=xray /usr/local/bin/xray /usr/local/bin/xray
COPY --from=mihomo /usr/local/bin/mihomo /usr/local/bin/mihomo
COPY --from=singbox /usr/local/bin/sing-box /usr/local/bin/sing-box
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
