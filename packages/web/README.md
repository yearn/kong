This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## MQ Dashboard (Dev Only)

A queue dashboard is available at [http://localhost:3000/mq](http://localhost:3000/mq) for browsing BullMQ queues during development.

**Features:**
- View all queue stats (waiting, active, completed, failed)
- Browse jobs by status with pagination
- JSON API at `/api/mq`

**Configuration** (only needed if not using default localhost Redis):
```
MQ_REDIS_HOST=your-redis-host
MQ_REDIS_PORT=6379
MQ_REDIS_USERNAME=...
MQ_REDIS_PASSWORD=...
MQ_REDIS_TLS=true
```

Only available when `NODE_ENV=development`.

## Cache refresh jobs

The Redis REST caches are refreshed by routes under `app/api/cron/`, scheduled by
`crons` in `vercel.json`. Every route requires `Authorization: Bearer $CRON_SECRET`
(Vercel Cron sends this header automatically) and pushes an up/down heartbeat to the
Uptime Kuma URL named in its route file.

| Route | Schedule | maxDuration |
|---|---|---|
| `/api/cron/refresh-cache` | `*/30 * * * *` | 300 |
| `/api/cron/timeseries-refresh` | `0 * * * *` | 300 |
| `/api/cron/timeseries-refresh-historical` | `15 2 * * *` | 800 |
| `/api/cron/reports-refresh` | manual only | 300 |
| `/api/cron/reports-refresh-historical` | manual only | 800 |

The historical timeseries rebuild fits within a single invocation's 800s limit, so it
runs once a day as a full pass over every vault.

Trigger any job by hand with:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<deployment>/api/cron/<route>
```

Or run it locally against your `.env.local`:

```bash
bun packages/web/app/api/rest/refresh-vaults.cli.ts
bun packages/web/app/api/rest/timeseries/refresh.cli.ts
bun packages/web/app/api/rest/timeseries/refresh-historical.cli.ts
bun packages/web/app/api/rest/reports/refresh.cli.ts
bun packages/web/app/api/rest/reports/refresh-historical.cli.ts
```

### Required Vercel environment variables

These jobs previously ran as GitHub Actions and read their secrets from the repo. They
must all exist in the Vercel project before the crons can work — there is no fallback.
Scope them to the Production environment only; previews must not read production
Postgres or write production Redis.

- `POSTGRES_HOST`, `POSTGRES_DATABASE`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
  `POSTGRES_PORT`, `POSTGRES_SSL`, `POSTGRES_POOL_MAX`
- `REST_CACHE_REDIS_URL`
- `CRON_SECRET` — new; a missing value makes every cron return 401
- `UPTIME_KUMA_PUSH_URL_REFRESH_VAULTS`, `UPTIME_KUMA_PUSH_URL_TIMESERIES_REFRESH`,
  `UPTIME_KUMA_PUSH_URL_TIMESERIES_HISTORICAL`, `UPTIME_KUMA_PUSH_URL_REPORTS_REFRESH`,
  `UPTIME_KUMA_PUSH_URL_REPORTS_HISTORICAL`

`POSTGRES_POOL_MAX` was sized for a single serial CI runner; on Vercel the pool is shared
with normal web traffic and concurrent cron invocations, so review it as part of the
cutover. Each Uptime Kuma monitor should also have a heartbeat interval tight enough to
alert on a run that never reports — a platform timeout kills the invocation before the
down-push can be sent.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
