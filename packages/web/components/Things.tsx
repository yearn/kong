'use client'

import { z } from 'zod'
import Frosty from './Frosty'
import { useData } from '@/hooks/useData'
import LineItem, { formatLineItemValue } from './LineItem'
import { useMemo } from 'react'

const IndexStatsSchema = z.object({
  things: z.array(z.object({
    label: z.string(),
    count: z.number({ coerce: true })
  })),
  things_total: z.number().optional().default(0),
  output_total: z.number().optional().default(0),
  evmlog_total: z.number().optional().default(0),
  eventCounts: z.array(z.object({
    event_name: z.string(),
    count: z.number({ coerce: true })
  }))
})

export default function Things() {
  const { monitor } = useData()

  const indexStats = useMemo(() => {
    const { indexStatsJson } = monitor
    const json = JSON.parse(indexStatsJson)
    const things = Object.keys(json).filter(key => key.startsWith('thing_')).map(key => ({
      label: key.replace('thing_', '').replace('_total', ''),
      count: json[key]
    }))
    return IndexStatsSchema.parse({ ...json, things, things_total: json.thing_total })
  }, [monitor])

  const lineItems = useMemo(() => {
    const result = indexStats.things.filter(thing => thing.label !== 'total').map(thing => ({ 
      label: thing.label, 
      value: thing.count 
    })).sort((a, b) => b.value - a.value)
    return result
  }, [indexStats])

  return <div className={'w-full flex flex-col items-start'}>
    <div className="w-full flex items-center justify-between">
      <div className="font-bold text-lg">Things</div>
      <Frosty _key={`thing_total-${indexStats.things_total}`} disabled={indexStats.things_total < 1}>{formatLineItemValue(indexStats.things_total)}</Frosty>
    </div>
    {lineItems.map(({ label, value }) => (
      <LineItem key={label} label={label} value={value} />
    ))}
  </div>
}
