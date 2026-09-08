type Blob = Record<string, unknown>

function record(value: unknown): Blob {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Blob : {}
}

export function allocatorSnapshotFields(hook: Blob): Blob {
  const state = record(hook.allocatorState)
  const materialized = state.schemaVersion === 1
  const ratios = record(state.ratios)
  const fields: Blob = {
    allocator: materialized ? state.address ?? null : null,
    allocatorState: materialized ? state : { schemaVersion: 1, status: 'unavailable', reason: 'not_materialized', address: null }
  }
  for (const field of ['debts', 'composition']) {
    const rows = hook[field]
    if (!Array.isArray(rows)) continue
    fields[field] = rows.map(value => {
      const row = record(value)
      const key = row.strategy ?? row.address
      const ratio = typeof key === 'string' ? record(ratios[key.toLowerCase()]) : {}
      return { ...row, targetDebtRatio: ratio.targetDebtRatio ?? null, maxDebtRatio: ratio.maxDebtRatio ?? null }
    })
  }
  return fields
}

// Apply all allocator fields under the snapshot row lock. A delayed job cannot
// roll the projection backwards or mix one allocator's targets with another.
export function mergeAllocatorHook(current: Blob, incoming: Blob): Blob {
  const previous = record(current.allocatorState)
  const next = record(incoming.allocatorState)
  const older = previous.schemaVersion === 1 && next.schemaVersion === 1 && (
    (typeof previous.observedAt === 'string' && typeof next.observedAt === 'string' && previous.observedAt > next.observedAt) ||
    (typeof previous.asOfBlock === 'number' && typeof next.asOfBlock === 'number' && previous.asOfBlock > next.asOfBlock && next.revision != null)
  )
  const merged = { ...current, ...incoming, ...(older ? { allocatorState: previous } : {}) }
  if (!('allocatorState' in merged)) return merged
  return { ...merged, ...allocatorSnapshotFields(merged) }
}

// The same precedence rule used by the GraphQL SQL projection and REST JS merge.
// Snapshot contract fields must never override the materialized allocator fields.
export const allocatorSnapshotSql = `jsonb_build_object(
  'allocator', CASE WHEN snapshot.hook->'allocatorState'->>'schemaVersion' = '1'
    THEN snapshot.hook->'allocatorState'->'address' ELSE 'null'::jsonb END,
  'allocatorState', CASE WHEN snapshot.hook->'allocatorState'->>'schemaVersion' = '1'
    THEN snapshot.hook->'allocatorState'
    ELSE '{"schemaVersion":1,"status":"unavailable","reason":"not_materialized","address":null}'::jsonb END
) ${['debts', 'composition'].map(field => `|| CASE WHEN jsonb_typeof(snapshot.hook->'${field}') = 'array' THEN jsonb_build_object('${field}',
  COALESCE((SELECT jsonb_agg(item || jsonb_build_object(
    'targetDebtRatio', snapshot.hook->'allocatorState'->'ratios'->lower(COALESCE(item->>'strategy', item->>'address'))->'targetDebtRatio',
    'maxDebtRatio', snapshot.hook->'allocatorState'->'ratios'->lower(COALESCE(item->>'strategy', item->>'address'))->'maxDebtRatio'
  )) FROM jsonb_array_elements(snapshot.hook->'${field}') item), '[]'::jsonb)) ELSE '{}'::jsonb END`).join(' ')}`
