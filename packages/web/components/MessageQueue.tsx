'use client'

import { useData } from '@/hooks/useData'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import AsciiMeter from './AsciiMeter'

function formatNumber(value: number) {
  if (value < 1000) return String(value).padStart(3, '0')
  if (value < 1e6) return String(Math.floor(value / 1e3)).padStart(3, '0') + 'K'
  if (value < 1e9) return String(Math.floor(value / 1e6)).padStart(3, '0') + 'M'
  return String(Math.floor(value / 1e9)).padStart(3, '0') + 'B'
}

function MessageQueueContent() {
  const { monitor } = useData()
  const searchParams = useSearchParams()
  const showErrors = searchParams.get('errors') === 'true'

  return <div className="flex flex-col gap-4">
    {monitor.queues.filter(queue => queue.name !== 'extract').map((queue) => <AsciiMeter
      key={queue.name}
      current={queue.active}
      current2={queue.waiting}
      max={(queue.name.includes('-')) ? 50 : 400}
      leftLabel={queue.name}
      rightLabel={`w ${formatNumber(queue.waiting)} / a ${formatNumber(queue.active)}`}
      errorCount={showErrors ? queue.failed : undefined}
      errorMax={showErrors ? 100 : undefined} />)}
  </div>
}

export default function MessageQueue() {
  return <div className={'w-full flex flex-col gap-2'}>
    <div id="message-queue" className="font-bold text-xl">Message Queue</div>
    <Suspense fallback={<div className="flex flex-col gap-4" />}>
      <MessageQueueContent />
    </Suspense>
  </div>
}
