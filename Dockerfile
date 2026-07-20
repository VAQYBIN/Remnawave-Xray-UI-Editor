FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci --workspace backend
COPY backend backend
RUN npm run build --workspace backend

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci --workspace backend --omit=dev
COPY --from=build /app/backend/dist backend/dist
COPY backend/public backend/public
WORKDIR /app/backend
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
