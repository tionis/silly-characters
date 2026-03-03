# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ pkg-config \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
COPY client/package.json client/package-lock.json ./client/

RUN npm ci --prefix server
RUN npm ci --prefix client

COPY . .

RUN npm run --prefix server build \
  && npm run --prefix client build \
  && npm prune --omit=dev --prefix server

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
  SILLYCHARACTERS_HOST=0.0.0.0 \
  SILLYCHARACTERS_PORT=48912

WORKDIR /app

COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/LICENSE ./LICENSE
COPY --from=build /app/NOTICE ./NOTICE

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 48912
VOLUME ["/app/data"]

CMD ["node", "server/dist/server.js"]
