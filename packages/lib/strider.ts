import { math } from '.'
import { Stride } from './types'

export function plan(from: bigint, to: bigint, travelled: Stride[] | undefined): Stride[] {
  if(!travelled) return [{ from, to }]
  travelled.sort((a, b) => Number(a.from - b.from))

  const result: Stride[] = []
  let startFrom = from

  for (const stride of travelled) {
    if (startFrom < stride.from) {
      if (stride.from - 1n > to) {
        result.push({ from: startFrom, to })
        return result
      } else {
        result.push({ from: startFrom, to: stride.from - 1n })
      }
    }
    startFrom = stride.to + 1n
  }

  if (startFrom <= to) {
    result.push({ from: startFrom, to })
  }

  return result
}

export function add(stride: Stride, strides: Stride[] | undefined): Stride[] {
  if (!strides || strides.length === 0) return [stride]
  strides.sort((a, b) => Number(a.from - b.from))

  let merged = [stride]
  for (const _stride of strides) {
    let added = false
    merged = merged.map(m => {
      if ((_stride.to >= m.from && _stride.from <= m.to)
        || _stride.to + 1n === m.from
        || _stride.from - 1n === m.to
      ) {
        added = true
        return { from: math.min(_stride.from, m.from), to: math.max(_stride.to, m.to) }
      }
      return m
    })
    if (!added) merged.push(_stride)
  }

  let hasOverlap = true
  while (hasOverlap) {
    hasOverlap = false
    for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        if ((merged[i].to >= merged[j].from && merged[i].from <= merged[j].to)
          || merged[i].to + 1n === merged[j].from
          || merged[i].from - 1n === merged[j].to
        ) {
          merged[i] = { from: math.min(merged[i].from, merged[j].from), to: math.max(merged[i].to, merged[j].to) }
          merged.splice(j, 1)
          hasOverlap = true
          break
        }
      }
      if (hasOverlap) break
    }
  }

  return merged.sort((a, b) => Number(a.from - b.from))
}

export function remove(stride: Stride, strides: Stride[] | undefined): Stride[] {
  if (!strides || strides.length === 0) return []
  strides.sort((a, b) => Number(a.from - b.from))

  const result: Stride[] = []

  for (const _stride of strides) {
    // If stride is completely before toremove, keep it as is
    if (_stride.to < stride.from) {
      result.push(_stride)
      continue
    }

    // If stride is completely after toremove, keep it as is
    if (_stride.from > stride.to) {
      result.push(_stride)
      continue
    }

    // If there's a part before toremove, keep it
    if (_stride.from < stride.from) {
      result.push({ from: _stride.from, to: stride.from - 1n })
    }

    // If there's a part after toremove, keep it
    if (_stride.to > stride.to) {
      result.push({ from: stride.to + 1n, to: _stride.to })
    }
  }

  return result
}

export function contains(a: Stride, b: Stride) {
  return a.from <= b.from && a.to >= b.to
}

export function rollback(strides: Stride[], endBlock: bigint): Stride[] {
  if (!strides || strides.length === 0) return []

  // Find the last stride
  const sorted = [...strides].sort((a, b) => Number(a.from - b.from))
  const lastStride = sorted[sorted.length - 1]

  // If the last stride ends after endBlock, truncate it
  if (lastStride.to > endBlock) {
    return [
      ...sorted.slice(0, -1),
      { from: lastStride.from, to: endBlock }
    ]
  }

  // Otherwise return strides as-is
  return sorted
}
