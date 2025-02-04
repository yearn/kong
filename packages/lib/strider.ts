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

export function add(next: Stride, travelled: Stride[] | undefined): Stride[] {
  if (!travelled || travelled.length === 0) return [next]
  travelled.sort((a, b) => Number(a.from - b.from))

  let merged = [next]
  for (const stride of travelled) {
    let added = false
    merged = merged.map(m => {
      if ((stride.to >= m.from && stride.from <= m.to) 
        || stride.to + 1n === m.from 
        || stride.from - 1n === m.to
      ) {
        added = true
        return { from: math.min(stride.from, m.from), to: math.max(stride.to, m.to) }
      }
      return m
    })
    if (!added) merged.push(stride)
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

export function contains(a: Stride, b: Stride) {
  return a.from <= b.from && a.to >= b.to
}
