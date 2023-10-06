import Monitor from '@/components/Monitor'
import Ahoy from '@/components/Ahoy'
import LatestBlocks from '@/components/LatestBlocks'
import Vaults from '@/components/Vaults'
import Deposits from '@/components/Deposits'
import Vault from '@/components/Vault'
import Harvests from '@/components/Harvests'

export default function Home() {
  return <main className="w-full min-h-screen sm:h-screen px-8 flex gap-2">
    <div className="w-1/3">
      <Ahoy />
      <LatestBlocks />
      <Monitor />
    </div>
    <div className="w-1/3 flex flex-col items-center justify-start gap-8">
      <Vaults />
      <Vault />
    </div>
    <div className="w-1/3 flex flex-col items-center justify-between">
      <Deposits className="w-full h-1/2" />
      <Harvests className="w-full h-1/2" />
    </div>
  </main>
}
