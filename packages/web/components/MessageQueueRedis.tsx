'use client'

import { useData } from '@/hooks/useData'
import AsciiMeter from './AsciiMeter'
import prettyBytes from 'pretty-bytes'

export default function MessageQueueRedis() {
  const { monitor } = useData()
  return <div className="w-full flex flex-col gap-2">
    <div id="redis" className="font-bold text-xl">Redis</div>
    <div className="w-full flex flex-col justify-between gap-4">
      <AsciiMeter
        current={monitor.redis.memory.used}
        max={monitor.redis.memory.total}
        leftLabel='memory'
        rightLabel={`${prettyBytes(monitor.redis.memory.used)} / ${prettyBytes(monitor.redis.memory.total)}`} />
      <AsciiMeter
        current={monitor.redis.clients}
        max={250}
        leftLabel='clients'
        rightLabel={`${monitor.redis.clients} / 250`} />
    </div>
  </div>
}