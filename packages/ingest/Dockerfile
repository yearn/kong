FROM oven/bun:1.3.10 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/lib/package.json packages/lib/package.json
COPY packages/ingest/package.json packages/ingest/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/terminal/package.json packages/terminal/package.json
COPY packages/scripts/package.json packages/scripts/package.json
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.10
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .
ENV NODE_ENV=production
CMD ["bun", "packages/ingest/index.ts"]
