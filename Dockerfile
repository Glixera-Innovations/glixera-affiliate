# syntax=docker/dockerfile:1

FROM node:24-alpine AS base

WORKDIR /app

FROM base AS build

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN test -f src/customIds.ts || \
    (echo >&2 "ERROR: src/customIds.ts is missing from the Docker build context. Check the exact filename casing." && exit 1)
RUN npm run build

FROM base AS production-dependencies

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS runtime

ENV NODE_ENV=production
ENV DATA_DIR=/data

RUN apk add --no-cache su-exec

COPY --chown=node:node package.json package-lock.json ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--enable-source-maps", "dist/bootstrap.js"]
