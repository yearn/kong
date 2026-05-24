FROM node:20-slim

RUN npm install -g bun

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/web/package.json ./packages/web/
COPY packages/lib/package.json ./packages/lib/
COPY packages/ingest/package.json ./packages/ingest/
COPY packages/db/package.json ./packages/db/
COPY packages/scripts/package.json ./packages/scripts/
COPY packages/terminal/package.json ./packages/terminal/

RUN bun install --frozen-lockfile

COPY packages/web ./packages/web
COPY packages/lib ./packages/lib
COPY packages/ingest ./packages/ingest
COPY config ./config

EXPOSE 3001

WORKDIR /app/packages/web

CMD ["../../node_modules/.bin/next", "dev", "-p", "3001"]
