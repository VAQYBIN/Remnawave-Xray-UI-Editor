# Ядро для проверки конфига (`xray run -test`). Версия совпадает с той, что
# использует Remnawave: проверять конфиг чужим ядром бессмысленно. sha256 взят
# из Xray-linux-64.zip.dgst того же релиза; при смене версии двигать оба ARG.
FROM alpine:3.24 AS xray
ARG XRAY_VERSION=v26.6.27
ARG XRAY_SHA256=b3e5902d06d6282fe53cfa2fc426058b9aeaa429b2c812e20887cd47f26d08bf
RUN apk add --no-cache curl unzip \
 && curl -fsSL -o /tmp/xray.zip \
    "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-64.zip" \
 && echo "${XRAY_SHA256}  /tmp/xray.zip" | sha256sum -c - \
 && unzip -j /tmp/xray.zip xray -d /usr/local/bin \
 && chmod +x /usr/local/bin/xray \
 && rm /tmp/xray.zip

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
WORKDIR /app/backend
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
