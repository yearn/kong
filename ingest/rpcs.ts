import { chains } from 'lib'
import { PublicClient, createPublicClient, webSocket } from 'viem'
import { Chain } from 'viem/chains'

export interface RpcClients { [chaindId: number]: PublicClient }

class pool {
  private recycle = 10 * 60 * 1000
  private recycling: NodeJS.Timeout | undefined
  private rpcs = {} as { [chainId: number]: { 
    clients: PublicClient[], 
    pointers: { next: number, recycle: number } 
  }}

  private wss(chain: Chain) {
    return process.env[`WSS_NETWORK_${chain.id}`] as string
  }

  private setupRpcs() {
    for(const chain of chains) {
      this.rpcs[chain.id] = {
        clients: Array(2).fill(createPublicClient({
          chain, transport: webSocket(this.wss(chain))
        })),
        pointers: { next: 0, recycle: 0 }
      }      
    }
  }

  private startRecycling() {
    this.recycling = setInterval(async () => {
      Object.keys(this.rpcs).forEach(chainId => {
        const forChain = this.rpcs[parseInt(chainId)]
        const clients = forChain.clients
        const pointer = forChain.pointers.recycle
        const rpc = clients[pointer]
        console.log('♻️ ', 'rpc', chainId, pointer)
        clients[pointer] = createPublicClient({
          chain: rpc.chain, transport: webSocket(this.wss(rpc.chain as Chain))
        })
        forChain.pointers.recycle = (pointer + 1) % clients.length
      })
    }, this.recycle)
  }

  up() {
    this.setupRpcs()
    this.startRecycling()
  }

  private nextForChain(chainId: number) {
    const result = this.rpcs[chainId].clients[this.rpcs[chainId].pointers.next]
    this.rpcs[chainId].pointers.next = (this.rpcs[chainId].pointers.next + 1) % this.rpcs[chainId].clients.length
    return result
  }

  next() {
    const result = {} as RpcClients
    Object.keys(this.rpcs).forEach(chainId => {
      result[parseInt(chainId)] = this.nextForChain(parseInt(chainId))
    })
    return result
  }

  down() {
    if(this.recycling) clearInterval(this.recycling)
    Object.values(this.rpcs).forEach(forChain => { 
      forChain.clients.length = 0
      forChain.pointers.next = 0
      forChain.pointers.recycle = 0
    })
  }

}

export const rpcs = new pool()
