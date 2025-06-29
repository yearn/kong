'use client'

import { useData } from '@/hooks/useData'
import AsciiMeter from './AsciiMeter'
import prettyBytes from 'pretty-bytes'
import { fPercent } from '@/lib/format'

export default function Postgres() {
  const { monitor } = useData()
  return <div className="w-full flex flex-col gap-2">
    <div className="font-bold text-xl">Postgres</div>
    <div className="w-full flex flex-col justify-between gap-4">
      <AsciiMeter
        current={monitor.db.databaseSize}
        max={128 * 1024 * 1024 * 1024}
        leftLabel='disk'
        rightLabel={`${prettyBytes(Number(monitor.db.databaseSize))} / ${prettyBytes(128 * 1024 * 1024 * 1024)}`} />

      <AsciiMeter
        current={monitor.db.clients}
        max={100}
        leftLabel='clients'
        rightLabel={`${monitor.db.clients} / 100`} />

      <AsciiMeter
        current={Math.floor(monitor.db.indexHitRate * 100)}
        max={100}
        leftLabel='index h/r'
        rightLabel={fPercent(monitor.db.indexHitRate)} />

      <AsciiMeter
        current={Math.floor(monitor.db.cacheHitRate * 100)}
        max={100}
        leftLabel='cache h/r'
        rightLabel={fPercent(monitor.db.cacheHitRate)} />

    </div>
  </div>
}
