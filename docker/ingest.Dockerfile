FROM node:20-slim

RUN npm install -g bun

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/ingest/package.json ./packages/ingest/
COPY packages/lib/package.json ./packages/lib/
COPY packages/db/package.json ./packages/db/
COPY packages/scripts/package.json ./packages/scripts/
COPY packages/terminal/package.json ./packages/terminal/
COPY packages/web/package.json ./packages/web/

RUN bun install --frozen-lockfile

COPY packages/ingest ./packages/ingest
COPY packages/lib ./packages/lib
COPY packages/db ./packages/db
COPY config ./config

WORKDIR /app/packages/ingest

CMD ["../../node_modules/.bin/ts-node", "--transpile-only", "index.ts"]
