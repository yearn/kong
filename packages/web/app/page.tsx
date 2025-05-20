import Ahoy from '@/components/Ahoy'
import LatestBlocks from '@/components/LatestBlocks'

import MessageQueue from '@/components/MessageQueue'
import MessageQueueRedis from '@/components/MessageQueueRedis'
import Postgres from '@/components/Postgres'
import Things from '@/components/Things'
import Evmlogs from '@/components/Evmlogs'
import Outputs from '@/components/Outputs'

export default function Home() {
  return <main className="relative w-full min-h-screen sm:h-auto flex justify-center">

    <div className="w-full sm:w-[542px] px-4 sm:px-8 pt-4 py-8 flex flex-col gap-12 bg-zinc-950">
      <Ahoy />
      <Things />
      <MessageQueue />
      <MessageQueueRedis />
      <Postgres />
      <LatestBlocks />
      <Outputs />
      <Evmlogs />
    </div>
  </main>
}
