import { Chain } from "viem";
import {
  mainnet,
  optimism,
  arbitrum,
  polygon,
  fantom,
  base,
} from "viem/chains";
import { PublicClient, createPublicClient, http } from "viem";

// Initialize chains first
export const chains: Chain[] = [
  mainnet,
  optimism,
  arbitrum,
  polygon,
  fantom,
  base,
];

export interface RpcClients {
  [chaindId: number]: PublicClient;
}

class pool {
  private recycling: any;
  private rpcs = {} as {
    [key: string]: {
      clients: PublicClient[];
      pointers: { next: number; recycle: number };
    };
  };

  constructor(private size: number, private recycleMs: number) {}

  private http(chain: Chain, archive: boolean) {
    if (archive) return process.env[`HTTP_ARCHIVE_${chain.id}`] as string;
    return process.env[`HTTP_FULLNODE_${chain.id}`] as string;
  }

  private key(chain: Chain, archive: boolean) {
    return `${chain.id}-${archive}`;
  }

  private parseKey(key: string) {
    const parts = key.split("-");
    return { chainId: parseInt(parts[0]), archive: parts[1] === "true" };
  }

  private setupRpcs() {
    for (const chain of chains) {
      for (const archive of [true, false]) {
        this.rpcs[this.key(chain, archive)] = {
          clients: Array(this.size).fill(
            createPublicClient({
              chain,
              transport: http(this.http(chain, archive), {
                batch: {
                  batchSize: Number(process.env[`RPC_BATCH_SIZE`] || 0),
                },
              }),
            })
          ),
          pointers: { next: 0, recycle: 0 },
        };
      }
    }
  }

  private startRecycling() {
    this.recycling = setInterval(async () => {
      Object.keys(this.rpcs).forEach((key) => {
        const { chainId, archive } = this.parseKey(key);
        const rpcsForKey = this.rpcs[key];
        const clients = rpcsForKey.clients;
        const pointer = rpcsForKey.pointers.recycle;
        const to_recycle = clients[pointer];
        console.log("♻️ ", "rpc", chainId, pointer);
        clients[pointer] = createPublicClient({
          chain: to_recycle.chain,
          transport: http(this.http(to_recycle.chain as Chain, archive)),
        });
        rpcsForKey.pointers.recycle = (pointer + 1) % clients.length;
      });
    }, this.recycleMs);
  }

  async up() {
    this.setupRpcs();
    if (this.size < 2) return;
    this.startRecycling();
  }

  async down() {
    if (this.recycling) {
      clearInterval(this.recycling);
      this.recycling = undefined;
    }
    for (const pool of Object.values(this.rpcs)) {
      pool.clients.length = 0;
      pool.pointers.next = 0;
      pool.pointers.recycle = 0;
    }
  }

  next(chainId: number, archive = true) {
    const chain = chains.find((chain) => chain.id === chainId);
    if (!chain) throw new Error(`!chain, ${chainId}`);
    const key = this.key(chain, archive);
    const rpcs = this.rpcs[key];
    const result = rpcs.clients[rpcs.pointers.next];
    rpcs.pointers.next = (rpcs.pointers.next + 1) % rpcs.clients.length;
    return result;
  }
}

export const rpcs = new pool(1, 10 * 60 * 1000);

// Initialize the pool immediately
rpcs.up();

// Export the initialized pool
export default rpcs;
