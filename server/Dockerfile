# Builds the web app and the Source Easy server into one image. Build context: repo root.
FROM node:24-slim AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:24-slim AS server
WORKDIR /src/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npx tsc -p . && npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 WEB_DIR=/app/web
WORKDIR /app/server
COPY --from=server /src/server/node_modules ./node_modules
COPY --from=server /src/server/dist ./dist
COPY --from=server /src/server/package.json ./
COPY --from=web /src/web/dist /app/web
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
