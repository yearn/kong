/**
 * Issue #439 Phase 2 — compare REST API values between prod Kong and a fork
 * (Neon branch / USE_PRICE_SERVICE trial).
 *
 * Pulls list, snapshot, and TVL timeseries for a curated set of vaults and
 * reports relative diffs on price-influenced fields. Timeseries is constrained
 * to the fork's available range (last --days ending at the fork's newest point);
 * prod-only history is ignored. Slight intraday drift is expected; overall
 * TVL / priceUsd should stay within --threshold.
 *
 * Usage:
 *   bun run src/quality-assurance/compare-rest-prod-fork.ts \
 *     --fork http://localhost:3001 \
 *     [--prod https://kong.yearn.fi] \
 *     [--threshold 0.05] \
 *     [--days 14] \
 *     [--vaults 1:0xabc...,1:0xdef...] \
 *     [--json report.json]
 */

import { parseArgs } from 'util'
import { writeFileSync } from 'fs'

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    prod: { type: 'string', default: 'https://kong.yearn.fi' },
    fork: { type: 'string' },
    threshold: { type: 'string', default: '0.05' },
    days: { type: 'string', default: '14' },
    vaults: { type: 'string' },
    json: { type: 'string', short: 'j' },
    // totalAssets should match tightly (not price-derived)
    'assets-threshold': { type: 'string', default: '0.001' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help || !values.fork) {
  console.log(`compare-rest-prod-fork — issue #439 Phase 2 verification

Compares price-influenced REST fields between prod Kong and a fork.

Required:
  --fork <url>          Fork base URL (e.g. http://localhost:3001)

Optional:
  --prod <url>          Prod base URL (default: https://kong.yearn.fi)
  --threshold <n>       Max relative diff for price-influenced fields (default: 0.05 = 5%)
  --assets-threshold <n> Max relative diff for totalAssets (default: 0.001 = 0.1%)
  --days <n>            How many recent TVL timeseries days to compare (default: 14)
  --vaults <list>       Comma-separated chainId:address pairs (default: curated set)
  --json, -j <path>     Write full JSON report to file
  --help, -h            Show this help

Exit code 1 if any comparison exceeds its threshold.
`)
  process.exit(values.help ? 0 : 1)
}

const PROD_BASE = stripTrailingSlash(values.prod!)
const FORK_BASE = stripTrailingSlash(values.fork!)
const PRICE_THRESHOLD = Number(values.threshold)
const ASSETS_THRESHOLD = Number(values['assets-threshold'])
const DAYS = Number(values.days)

if (!Number.isFinite(PRICE_THRESHOLD) || PRICE_THRESHOLD < 0) {
  console.error('Invalid --threshold')
  process.exit(1)
}
if (!Number.isFinite(ASSETS_THRESHOLD) || ASSETS_THRESHOLD < 0) {
  console.error('Invalid --assets-threshold')
  process.exit(1)
}
if (!Number.isFinite(DAYS) || DAYS < 1) {
  console.error('Invalid --days')
  process.exit(1)
}

/** Curated vaults from issue #439 Phase 2 (mainnet). */
const DEFAULT_VAULTS: VaultRef[] = [
  { chainId: 1, address: '0x751F0cC6115410A3eE9eC92d08f46Ff6Da98b708', label: 'BTC (yvWBTC-1)' },
  { chainId: 1, address: '0xc56413869c6CDf96496f2b1eF801fEDBdFA7dDB0', label: 'ETH (yvWETH-1)' },
  { chainId: 1, address: '0x1Fc80CfCF5B345b904A0fB36d4222196Ed9eB8a5', label: 'Curve (yvCurve-DOLA-sUSDe-f)' },
  { chainId: 1, address: '0x696d02Db93291651ED510704c9b286841d506987', label: 'YVUSD' },
  { chainId: 1, address: '0x9F4330700a36B29952869fac9b33f45EEdd8A3d8', label: 'YBOLD' },
]

type VaultRef = { chainId: number; address: string; label?: string }

type ListItem = {
  chainId: number
  address: string
  name?: string
  symbol?: string | null
  tvl?: number | null
  pricePerShare?: number | null
  performance?: {
    oracle?: Record<string, number | null | undefined>
    historical?: Record<string, number | null | undefined>
    estimated?: { apr?: number; apy?: number; type?: string; components?: Record<string, unknown> }
  } | null
  asset?: { address?: string; symbol?: string; decimals?: number | null } | null
}

type Snapshot = {
  chainId?: number
  address?: string
  name?: string
  symbol?: string
  pricePerShare?: number | string | null
  totalAssets?: number | string | null
  tvl?: { close?: number | null; tvl?: number | null; component?: string } | number | null
  [key: string]: unknown
}

type TimeseriesPoint = { time: number; component: string; value: number | string }

type DiffStatus = 'ok' | 'warn' | 'fail' | 'missing' | 'skip'

type FieldDiff = {
  path: string
  prod: number | null
  fork: number | null
  absDiff: number | null
  relDiff: number | null
  threshold: number
  status: DiffStatus
  note?: string
}

type TimeseriesSummary = {
  component: string
  pointsCompared: number
  maxRelDiff: number | null
  meanAbsRelDiff: number | null
  failCount: number
  rangeFrom: string | null
  rangeTo: string | null
  note?: string
}

type VaultReport = {
  chainId: number
  address: string
  label: string
  list: FieldDiff[]
  snapshot: FieldDiff[]
  timeseries: FieldDiff[]
  timeseriesSummary: TimeseriesSummary[]
  /** Fork timeseries coverage used for this vault (unix sec), null if empty. */
  timeseriesRange: { from: number; to: number } | null
  errors: string[]
}

type Report = {
  generatedAt: string
  prod: string
  fork: string
  priceThreshold: number
  assetsThreshold: number
  days: number
  vaults: VaultReport[]
  summary: {
    vaults: number
    fieldsCompared: number
    ok: number
    warn: number
    fail: number
    missing: number
    skip: number
  }
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function parseVaults(raw: string | undefined): VaultRef[] {
  if (!raw?.trim()) return DEFAULT_VAULTS
  return raw.split(',').map((part) => {
    const [chain, address, ...rest] = part.trim().split(':')
    if (!chain || !address) {
      throw new Error(`Invalid --vaults entry "${part}". Expected chainId:address`)
    }
    const chainId = Number(chain)
    if (!Number.isFinite(chainId)) {
      throw new Error(`Invalid chainId in --vaults entry "${part}"`)
    }
    return {
      chainId,
      address: address.toLowerCase(),
      label: rest.length ? rest.join(':') : undefined,
    }
  })
}

async function fetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; status: number; body: string }> {
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
  })
  const body = await res.text()
  if (!res.ok) {
    return { ok: false, status: res.status, body: body.slice(0, 200) }
  }
  try {
    return { ok: true, data: JSON.parse(body) as T }
  } catch {
    return { ok: false, status: res.status, body: `invalid JSON: ${body.slice(0, 120)}` }
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function relDiff(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-12)
  return Math.abs(a - b) / denom
}

function classify(
  prod: number | null,
  fork: number | null,
  threshold: number,
): DiffStatus {
  if (prod === null && fork === null) return 'skip'
  if (prod === null || fork === null) return 'missing'
  const r = relDiff(prod, fork)
  if (r === null) return 'skip'
  if (r <= threshold) return 'ok'
  // soft band: up to 2x threshold = warn (intraday expected drift)
  if (r <= threshold * 2) return 'warn'
  return 'fail'
}

function makeDiff(path: string, prod: number | null, fork: number | null, threshold: number, note?: string): FieldDiff {
  const abs = prod !== null && fork !== null ? Math.abs(prod - fork) : null
  const rel = relDiff(prod, fork)
  return {
    path,
    prod,
    fork,
    absDiff: abs,
    relDiff: rel,
    threshold,
    status: classify(prod, fork, threshold),
    note,
  }
}

function snapshotTvl(snapshot: Snapshot | null): number | null {
  if (!snapshot) return null
  const tvl = snapshot.tvl
  if (typeof tvl === 'number') return toNumber(tvl)
  if (tvl && typeof tvl === 'object') {
    return toNumber(tvl.close ?? tvl.tvl)
  }
  return null
}

function findListItem(list: ListItem[], chainId: number, address: string): ListItem | undefined {
  const addr = address.toLowerCase()
  return list.find((v) => v.chainId === chainId && v.address.toLowerCase() === addr)
}

function isoDay(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10)
}

/** Time span of fork points; used as the only comparison window. */
function forkTimeRange(points: TimeseriesPoint[]): { min: number; max: number } | null {
  if (points.length === 0) return null
  let min = points[0]!.time
  let max = points[0]!.time
  for (const p of points) {
    if (p.time < min) min = p.time
    if (p.time > max) max = p.time
  }
  return { min, max }
}

/**
 * Keep points in [forkMax - days, forkMax], clamped to fork's actual min.
 * Prod is filtered to the same window so we never flag prod-only history.
 */
function constrainToForkRange(
  points: TimeseriesPoint[],
  forkRange: { min: number; max: number },
  days: number,
): TimeseriesPoint[] {
  const cutoff = Math.max(forkRange.min, forkRange.max - days * 86400)
  return points.filter((p) => p.time >= cutoff && p.time <= forkRange.max)
}

function compareTimeseries(
  component: string,
  prodPoints: TimeseriesPoint[],
  forkPoints: TimeseriesPoint[],
  threshold: number,
  range: { min: number; max: number } | null,
): { diffs: FieldDiff[]; summary: TimeseriesSummary } {
  const emptySummary = (note: string): TimeseriesSummary => ({
    component,
    pointsCompared: 0,
    maxRelDiff: null,
    meanAbsRelDiff: null,
    failCount: 0,
    rangeFrom: range ? isoDay(Math.max(range.min, range.max - DAYS * 86400)) : null,
    rangeTo: range ? isoDay(range.max) : null,
    note,
  })

  if (!range) {
    return { diffs: [], summary: emptySummary('fork has no timeseries; skipped') }
  }

  const prodByTime = new Map<number, number>()
  const forkByTime = new Map<number, number>()

  for (const p of prodPoints.filter((x) => x.component === component)) {
    const n = toNumber(p.value)
    if (n !== null) prodByTime.set(p.time, n)
  }
  for (const p of forkPoints.filter((x) => x.component === component)) {
    const n = toNumber(p.value)
    if (n !== null) forkByTime.set(p.time, n)
  }

  // Only timestamps the fork actually has (prod-only days outside coverage are ignored).
  const times = [...forkByTime.keys()].sort((a, b) => a - b)
  if (times.length === 0) {
    return { diffs: [], summary: emptySummary(`fork has no ${component} points in range; skipped`) }
  }

  const diffs: FieldDiff[] = []
  let maxRel: number | null = null
  let relSum = 0
  let relCount = 0
  let failCount = 0

  for (const t of times) {
    const prod = prodByTime.get(t) ?? null
    const fork = forkByTime.get(t) ?? null
    const diff = makeDiff(`timeseries.${component}@${isoDay(t)}`, prod, fork, threshold)
    diffs.push(diff)
    if (diff.relDiff !== null) {
      maxRel = maxRel === null ? diff.relDiff : Math.max(maxRel, diff.relDiff)
      relSum += diff.relDiff
      relCount++
    }
    if (diff.status === 'fail') failCount++
  }

  return {
    diffs,
    summary: {
      component,
      pointsCompared: times.length,
      maxRelDiff: maxRel,
      meanAbsRelDiff: relCount ? relSum / relCount : null,
      failCount,
      rangeFrom: isoDay(times[0]!),
      rangeTo: isoDay(times[times.length - 1]!),
    },
  }
}

async function compareVault(
  vault: VaultRef,
  prodList: ListItem[],
  forkList: ListItem[],
): Promise<VaultReport> {
  const address = vault.address.toLowerCase()
  const label = vault.label ?? `${vault.chainId}:${address}`
  const report: VaultReport = {
    chainId: vault.chainId,
    address,
    label,
    list: [],
    snapshot: [],
    timeseries: [],
    timeseriesSummary: [],
    timeseriesRange: null,
    errors: [],
  }

  // --- list ---
  const prodListItem = findListItem(prodList, vault.chainId, address)
  const forkListItem = findListItem(forkList, vault.chainId, address)

  if (!prodListItem) report.errors.push('missing from prod list')
  if (!forkListItem) report.errors.push('missing from fork list')

  report.list.push(
    makeDiff('list.tvl', toNumber(prodListItem?.tvl), toNumber(forkListItem?.tvl), PRICE_THRESHOLD, 'price-influenced'),
    makeDiff(
      'list.pricePerShare',
      toNumber(prodListItem?.pricePerShare),
      toNumber(forkListItem?.pricePerShare),
      ASSETS_THRESHOLD,
      'share price (not asset USD)',
    ),
  )

  // performance is not strictly price-derived, but useful signal
  for (const key of ['apr', 'apy', 'netAPR', 'netAPY'] as const) {
    report.list.push(
      makeDiff(
        `list.performance.oracle.${key}`,
        toNumber(prodListItem?.performance?.oracle?.[key]),
        toNumber(forkListItem?.performance?.oracle?.[key]),
        PRICE_THRESHOLD,
      ),
    )
  }
  for (const key of ['net', 'weeklyNet', 'monthlyNet'] as const) {
    report.list.push(
      makeDiff(
        `list.performance.historical.${key}`,
        toNumber(prodListItem?.performance?.historical?.[key]),
        toNumber(forkListItem?.performance?.historical?.[key]),
        PRICE_THRESHOLD,
      ),
    )
  }

  // --- snapshot ---
  const prodSnapUrl = `${PROD_BASE}/api/rest/snapshot/${vault.chainId}/${address}`
  const forkSnapUrl = `${FORK_BASE}/api/rest/snapshot/${vault.chainId}/${address}`
  const [prodSnapRes, forkSnapRes] = await Promise.all([
    fetchJson<Snapshot>(prodSnapUrl),
    fetchJson<Snapshot>(forkSnapUrl),
  ])

  if (!prodSnapRes.ok) report.errors.push(`prod snapshot ${prodSnapRes.status}: ${prodSnapRes.body}`)
  if (!forkSnapRes.ok) report.errors.push(`fork snapshot ${forkSnapRes.status}: ${forkSnapRes.body}`)

  const prodSnap = prodSnapRes.ok ? prodSnapRes.data : null
  const forkSnap = forkSnapRes.ok ? forkSnapRes.data : null

  report.snapshot.push(
    makeDiff('snapshot.tvl', snapshotTvl(prodSnap), snapshotTvl(forkSnap), PRICE_THRESHOLD, 'price-influenced'),
    makeDiff(
      'snapshot.totalAssets',
      toNumber(prodSnap?.totalAssets),
      toNumber(forkSnap?.totalAssets),
      ASSETS_THRESHOLD,
      'on-chain; should match tightly',
    ),
    makeDiff(
      'snapshot.pricePerShare',
      toNumber(prodSnap?.pricePerShare),
      toNumber(forkSnap?.pricePerShare),
      ASSETS_THRESHOLD,
      'share price (not asset USD)',
    ),
  )

  // --- timeseries tvl / priceUsd / totalAssets ---
  const components = ['tvl', 'priceUsd', 'totalAssets']
  const qs = components.map((c) => `components=${encodeURIComponent(c)}`).join('&')
  const prodTsUrl = `${PROD_BASE}/api/rest/timeseries/tvl/${vault.chainId}/${address}?${qs}`
  const forkTsUrl = `${FORK_BASE}/api/rest/timeseries/tvl/${vault.chainId}/${address}?${qs}`
  const [prodTsRes, forkTsRes] = await Promise.all([
    fetchJson<TimeseriesPoint[]>(prodTsUrl),
    fetchJson<TimeseriesPoint[]>(forkTsUrl),
  ])

  if (!prodTsRes.ok) report.errors.push(`prod timeseries ${prodTsRes.status}: ${prodTsRes.body}`)
  if (!forkTsRes.ok) report.errors.push(`fork timeseries ${forkTsRes.status}: ${forkTsRes.body}`)

  const forkRaw = forkTsRes.ok ? forkTsRes.data : []
  const prodRaw = prodTsRes.ok ? prodTsRes.data : []
  const forkRange = forkTimeRange(forkRaw)
  report.timeseriesRange = forkRange ? { from: forkRange.min, to: forkRange.max } : null

  // Window = last --days ending at fork's newest point (not prod's).
  const forkTs = forkRange ? constrainToForkRange(forkRaw, forkRange, DAYS) : []
  const prodTs = forkRange ? constrainToForkRange(prodRaw, forkRange, DAYS) : []

  for (const component of components) {
    const threshold = component === 'totalAssets' ? ASSETS_THRESHOLD : PRICE_THRESHOLD
    const { diffs, summary } = compareTimeseries(component, prodTs, forkTs, threshold, forkRange)
    report.timeseries.push(...diffs)
    report.timeseriesSummary.push(summary)
  }

  return report
}

function countStatuses(report: Report): void {
  const summary = report.summary
  for (const vault of report.vaults) {
    for (const field of [...vault.list, ...vault.snapshot, ...vault.timeseries]) {
      summary.fieldsCompared++
      summary[field.status]++
    }
  }
}

function pct(n: number | null): string {
  if (n === null) return '—'
  return `${(n * 100).toFixed(3)}%`
}

function num(n: number | null): string {
  if (n === null) return 'null'
  if (Math.abs(n) >= 1e6) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (Math.abs(n) >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
  return n.toPrecision(6)
}

function statusIcon(status: DiffStatus): string {
  switch (status) {
    case 'ok': return '✓'
    case 'warn': return '~'
    case 'fail': return '✗'
    case 'missing': return '?'
    case 'skip': return '-'
  }
}

function printReport(report: Report): void {
  console.log('\n=== REST prod vs fork comparison (issue #439 Phase 2) ===\n')
  console.log(`prod:             ${report.prod}`)
  console.log(`fork:             ${report.fork}`)
  console.log(`price threshold:  ${pct(report.priceThreshold)}`)
  console.log(`assets threshold: ${pct(report.assetsThreshold)}`)
  console.log(`timeseries days:  ${report.days}`)
  console.log(`generated:        ${report.generatedAt}`)
  console.log('')

  for (const vault of report.vaults) {
    console.log(`── ${vault.label}  ${vault.chainId}/${vault.address}`)
    if (vault.errors.length) {
      for (const err of vault.errors) console.log(`   ERROR: ${err}`)
    }

    const printFields = (title: string, fields: FieldDiff[], onlyInteresting = false) => {
      const rows = onlyInteresting
        ? fields.filter((f) => f.status !== 'ok' && f.status !== 'skip')
        : fields
      if (rows.length === 0 && onlyInteresting) {
        console.log(`   ${title}: all ok`)
        return
      }
      console.log(`   ${title}:`)
      for (const f of rows) {
        const rel = f.relDiff !== null ? pct(f.relDiff) : '—'
        console.log(
          `     ${statusIcon(f.status)} ${f.path.padEnd(42)} prod=${num(f.prod).padStart(14)}  fork=${num(f.fork).padStart(14)}  rel=${rel.padStart(10)}${f.note ? `  (${f.note})` : ''}`,
        )
      }
    }

    printFields('list', vault.list)
    printFields('snapshot', vault.snapshot)

    if (vault.timeseriesRange) {
      console.log(
        `   timeseries window (fork-anchored): ${isoDay(vault.timeseriesRange.from)} → ${isoDay(vault.timeseriesRange.to)} (last ${report.days}d from fork tip)`,
      )
    } else {
      console.log('   timeseries window: none (fork has no timeseries points)')
    }

    console.log('   timeseries summary:')
    for (const s of vault.timeseriesSummary) {
      const range =
        s.rangeFrom && s.rangeTo ? `${s.rangeFrom}→${s.rangeTo}` : '—'
      const note = s.note ? `  (${s.note})` : ''
      console.log(
        `     ${s.component.padEnd(12)} points=${String(s.pointsCompared).padStart(4)}  range=${range.padEnd(23)}  maxRel=${pct(s.maxRelDiff).padStart(10)}  meanRel=${pct(s.meanAbsRelDiff).padStart(10)}  fails=${s.failCount}${note}`,
      )
    }
    // only show non-ok day rows in the terminal
    const interesting = vault.timeseries.filter((f) => f.status === 'fail' || f.status === 'warn' || f.status === 'missing')
    if (interesting.length) {
      console.log(`   timeseries deltas (${interesting.length} non-ok of ${vault.timeseries.length}):`)
      for (const f of interesting.slice(0, 40)) {
        console.log(
          `     ${statusIcon(f.status)} ${f.path.padEnd(42)} prod=${num(f.prod).padStart(14)}  fork=${num(f.fork).padStart(14)}  rel=${pct(f.relDiff).padStart(10)}`,
        )
      }
      if (interesting.length > 40) {
        console.log(`     … ${interesting.length - 40} more (see --json)`)
      }
    } else if (vault.timeseries.length > 0) {
      console.log('   timeseries: all compared points within threshold')
    } else {
      console.log('   timeseries: skipped (no fork coverage to compare)')
    }
    console.log('')
  }

  const s = report.summary
  console.log('=== summary ===')
  console.log(`vaults:  ${s.vaults}`)
  console.log(`fields:  ${s.fieldsCompared}`)
  console.log(`ok:      ${s.ok}`)
  console.log(`warn:    ${s.warn}  (within 2× threshold — expected slight intraday drift)`)
  console.log(`fail:    ${s.fail}`)
  console.log(`missing: ${s.missing}`)
  console.log(`skip:    ${s.skip}`)
  console.log('')
  const vaultErrors = report.vaults.reduce((n, v) => n + v.errors.length, 0)
  if (s.fail > 0 || s.missing > 0 || vaultErrors > 0) {
    console.log('RESULT: FAIL — diffs beyond threshold, missing fields, or vault fetch errors')
  } else if (s.warn > 0) {
    console.log('RESULT: PASS WITH WARNINGS — inspect warn rows (expected slight intraday drift)')
  } else {
    console.log('RESULT: PASS')
  }
}

async function main() {
  let vaults: VaultRef[]
  try {
    vaults = parseVaults(values.vaults)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }

  console.log(`Fetching vault lists…`)
  console.log(`  prod: ${PROD_BASE}/api/rest/list/vaults`)
  console.log(`  fork: ${FORK_BASE}/api/rest/list/vaults`)

  const [prodListRes, forkListRes] = await Promise.all([
    fetchJson<ListItem[]>(`${PROD_BASE}/api/rest/list/vaults`),
    fetchJson<ListItem[]>(`${FORK_BASE}/api/rest/list/vaults`),
  ])

  if (!prodListRes.ok) {
    console.error(`Failed to fetch prod list: ${prodListRes.status} ${prodListRes.body}`)
    process.exit(1)
  }
  if (!forkListRes.ok) {
    console.error(`Failed to fetch fork list: ${forkListRes.status} ${forkListRes.body}`)
    process.exit(1)
  }

  console.log(`  prod vaults: ${prodListRes.data.length}`)
  console.log(`  fork vaults: ${forkListRes.data.length}`)
  console.log(`Comparing ${vaults.length} vaults…`)

  const vaultReports: VaultReport[] = []
  for (const vault of vaults) {
    process.stdout.write(`  ${vault.label ?? `${vault.chainId}:${vault.address}`}… `)
    const r = await compareVault(vault, prodListRes.data, forkListRes.data)
    vaultReports.push(r)
    const fails = [...r.list, ...r.snapshot, ...r.timeseries].filter((f) => f.status === 'fail').length
    const warns = [...r.list, ...r.snapshot, ...r.timeseries].filter((f) => f.status === 'warn').length
    console.log(fails ? `FAIL(${fails})` : warns ? `warn(${warns})` : 'ok')
  }

  const report: Report = {
    generatedAt: new Date().toISOString(),
    prod: PROD_BASE,
    fork: FORK_BASE,
    priceThreshold: PRICE_THRESHOLD,
    assetsThreshold: ASSETS_THRESHOLD,
    days: DAYS,
    vaults: vaultReports,
    summary: {
      vaults: vaultReports.length,
      fieldsCompared: 0,
      ok: 0,
      warn: 0,
      fail: 0,
      missing: 0,
      skip: 0,
    },
  }
  countStatuses(report)
  printReport(report)

  if (values.json) {
    writeFileSync(values.json, JSON.stringify(report, null, 2))
    console.log(`Wrote JSON report to ${values.json}`)
  }

  const vaultErrors = report.vaults.reduce((n, v) => n + v.errors.length, 0)
  const hardFail = report.summary.fail > 0 || report.summary.missing > 0 || vaultErrors > 0
  process.exit(hardFail ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
