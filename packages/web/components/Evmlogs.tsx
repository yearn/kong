'use client'

import { z } from 'zod'
import Frosty from './Frosty'
import { useData } from '@/hooks/useData'
import LineItem, { formatLineItemValue } from './LineItem'

const IndexStatsSchema = z.object({
  thing_total: z.number().optional().default(0),
  thing_vault_total: z.number().optional().default(0),
  thing_strategy_total: z.number().optional().default(0),
  thing_erc20_total: z.number().optional().default(0),
  thing_debtAllocator_total: z.number().optional().default(0),
  thing_accountant_total: z.number().optional().default(0),
  thing_tradeHandler_total: z.number().optional().default(0),
  output_total: z.number().optional().default(0),
  evmlog_total: z.number().optional().default(0),
  eventCounts: z.array(z.object({
    event_name: z.string(),
    count: z.number({ coerce: true })
  }))
})

export default function Evmlogs() {
  const { monitor } = useData()
  const { indexStatsJson } = monitor
  const indexStats = IndexStatsSchema.parse(JSON.parse(indexStatsJson))

  return <div className={'w-full flex flex-col items-start'}>
    <div className="w-full flex items-center justify-between">
      <div id="evmlogs" className="font-bold text-lg">Evmlogs</div>
      <Frosty _key={`thing_total-${indexStats.evmlog_total}`} disabled={indexStats.evmlog_total < 1}>{formatLineItemValue(indexStats.evmlog_total)}</Frosty>
    </div>

    {indexStats.eventCounts.map(event => 
      <LineItem key={event.event_name} label={`${event.event_name}`} value={event.count} />
    )}
  </div>
}
