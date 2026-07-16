#!/usr/bin/env bash
# Probes for tracing a value through kong's propagation chain.
# See SKILL.md in this directory for the hop map and interpretation guide.
#
# Usage:
#   probes.sh source   <url>                          # hop 1: source service, raw JSON
#   probes.sh output   <chainId> <address> <label>    # hop 2: output table, latest rows
#   probes.sh snapshot <chainId> <address>            # hop 3: snapshot table, hook performance
#   probes.sh redis    <chainId> <address>            # hop 4: REST cache entry
#   probes.sh rest     <chainId> <address>            # hop 5: public REST API (CDN edge)
#   probes.sh gql      <chainId> <address>            # fallback: live DB via public GraphQL
#   probes.sh watch    <chainId> <address> <prefix>   # poll hop 5 until estimated apr starts with <prefix>
set -euo pipefail

REST_BASE="https://kong.yearn.fi/api/rest"
GQL_URL="https://kong.yearn.fi/api/gql"

load_env() {
  set -a; source ~/.env; set +a
  : "${KONG_PROD_RO_REPLICA_DB:?KONG_PROD_RO_REPLICA_DB not set (check ~/.env; values with & must be quoted)}"
}

# Neon suspends the replica when idle; first connections fail until it wakes.
psql_retry() {
  for _ in 1 2 3 4 5 6; do
    if psql "$KONG_PROD_RO_REPLICA_DB" "$@" 2>/dev/null; then return 0; fi
    sleep 10
  done
  echo "replica connection failed after retries" >&2
  return 1
}

cmd="${1:?usage: probes.sh <source|output|snapshot|redis|rest|gql|watch> ...}"; shift

case "$cmd" in
  source)
    url="${1:?usage: probes.sh source <url>}"
    curl -sS --max-time 30 "$url"
    ;;

  output)
    chain="${1:?chainId}"; addr="${2:?address}"; label="${3:?label}"
    load_env
    psql_retry -c "
      SELECT address, component, value, block_time
      FROM output
      WHERE chain_id = ${chain}
        AND address = '${addr}'
        AND label = '${label}'
      ORDER BY block_time DESC, component
      LIMIT 12;"
    ;;

  snapshot)
    chain="${1:?chainId}"; addr="${2:?address}"
    load_env
    psql_retry -c "
      SELECT hook->'performance'->'estimated' AS estimated, block_time
      FROM snapshot
      WHERE chain_id = ${chain} AND address = '${addr}';"
    ;;

  redis)
    chain="${1:?chainId}"; addr="${2:?address}"
    load_env
    : "${KONG_REDIS_RO_URL:?KONG_REDIS_RO_URL not set}"
    # No redis-cli on this box; the RO user lacks INFO, hence enableReadyCheck: false.
    KEY="rest:snapshot:${chain}:$(echo "$addr" | tr 'A-F' 'a-f')" bun -e '
      const Redis = (await import("ioredis")).default
      const r = new Redis(process.env.KONG_REDIS_RO_URL, { lazyConnect: true, enableReadyCheck: false })
      await r.connect()
      const raw = await r.get(process.env.KEY)
      if (!raw) { console.log("cache miss:", process.env.KEY); await r.quit(); process.exit(0) }
      const snap = JSON.parse(raw)?.value
      console.log("estimated:", JSON.stringify(snap?.performance?.estimated))
      console.log("blockTime:", snap?.blockTime, "->", new Date(Number(snap?.blockTime) * 1000).toISOString())
      await r.quit()' 2>&1 | grep -v Warning
    ;;

  rest)
    chain="${1:?chainId}"; addr="${2:?address}"
    curl -sS --max-time 30 "${REST_BASE}/snapshot/${chain}/${addr}" | python3 -c "
import json, sys, datetime
d = json.load(sys.stdin)
bt = int(d['blockTime'])
print('blockTime:', datetime.datetime.fromtimestamp(bt, datetime.UTC).isoformat())
print('estimated:', json.dumps((d.get('performance') or {}).get('estimated')))"
    ;;

  gql)
    chain="${1:?chainId}"; addr="${2:?address}"
    curl -sS --max-time 30 "$GQL_URL" -H 'content-type: application/json' -d "{\"query\":\"{ vault(chainId: ${chain}, address: \\\"${addr}\\\") { performance { estimated { apr apy } } } }\"}" | python3 -m json.tool
    ;;

  watch)
    chain="${1:?chainId}"; addr="${2:?address}"; prefix="${3:?expected value prefix, e.g. 0.06119}"
    for _ in $(seq 1 30); do
      apr=$(curl -sS --max-time 20 "${REST_BASE}/snapshot/${chain}/${addr}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(((d.get('performance') or {}).get('estimated') or {}).get('apr', ''))" 2>/dev/null || true)
      echo "$(date -u +%H:%M:%S) -> ${apr:-<no value>}"
      case "$apr" in "$prefix"*) echo UPDATED; exit 0;; esac
      sleep 60
    done
    echo "TIMEOUT after 30 min"; exit 1
    ;;

  *)
    echo "unknown probe: $cmd" >&2; exit 1
    ;;
esac
