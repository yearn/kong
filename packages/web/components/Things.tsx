'use client'

import { z } from 'zod'
import Frosty from './Frosty'
import { useData } from '@/hooks/useData'
import LineItem, { formatLineItemValue } from './LineItem'
import { useEffect } from 'react'

const IndexStatsSchema = z.object({
  thing_total: z.number().optional().default(0),
  thing_vault_total: z.number().optional().default(0),
  thing_strategy_total: z.number().optional().default(0),
  thing_erc20_total: z.number().optional().default(0),
  thing_debtallocator_total: z.number().optional().default(0),
  thing_accountant_total: z.number().optional().default(0),
  thing_tradehandler_total: z.number().optional().default(0),
  output_total: z.number().optional().default(0),
  evmlog_total: z.number().optional().default(0),
  eventCounts: z.array(z.object({
    event_name: z.string(),
    count: z.number({ coerce: true })
  }))
})

export default function Things() {
  const { monitor } = useData()
  const { indexStatsJson } = monitor
  const indexStats = IndexStatsSchema.parse(JSON.parse(indexStatsJson))

  const lineItems = [
    { label: "vaults", value: indexStats.thing_vault_total },
    { label: "strategies", value: indexStats.thing_strategy_total },
    { label: "erc20s", value: indexStats.thing_erc20_total },
    { label: "debt allocators", value: indexStats.thing_debtallocator_total },
    { label: "accountants", value: indexStats.thing_accountant_total },
    { label: "trade handlers", value: indexStats.thing_tradehandler_total },
  ].sort((a, b) => b.value - a.value)

  return <div className={'w-full flex flex-col items-start'}>
    <div className="w-full flex items-center justify-between">
      <div className="font-bold text-lg">Things</div>
      <Frosty _key={`thing_total-${indexStats.thing_total}`} disabled={indexStats.thing_total < 1}>{formatLineItemValue(indexStats.thing_total)}</Frosty>
    </div>
    {lineItems.map(({ label, value }) => (
      <LineItem key={label} label={label} value={value} />
    ))}
  </div>
}
