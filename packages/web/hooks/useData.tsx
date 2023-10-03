'use client'

import { ReactNode, createContext, useContext, useEffect, useState } from 'react'

export interface LatestBlock {
  chainId: number
  blockNumber: number
}

export interface Vault {
  chainId: number
  address: string
  name: string
  apiVersion: string
  apetaxType: string
  apetaxStatus: string
  registryStatus: string
  tvlUsd: number
  tvlSparkline: {
    time: number
    value: number
  }[]
  withdrawalQueue: {
    name: string
    address: string
    netApr: number
  }[]
}

export interface TVL {
  open: number
  high: number
  low: number
  close: number
  period: string
  time: number
}

export interface Transfer {
  chainId: number
  address: string
  sender: string
  receiver: string
  amountUsd: number
  blockTimestamp: string
  transactionHash: string
}

export interface Harvest {
  chainId: number
  address: string
  lossUsd: number
  profitUsd: number
  blockTimestamp: string
  transactionHash: string
}

export interface MonitorResults {
  queues: {
    name: string
    waiting: number
    active: number
    failed: number
  }[]
  db: {
    databaseSize: number
    indexHitRate: number
    cacheHitRate: number
    clients: number
  }
  redis: {
    uptime: number
    clients: number
    memory: {
      total: number
      used: number
      peak: number
    }
  }
}

export interface DataContext {
  latestBlocks: LatestBlock[]
  vaults: Vault[]
  tvls: TVL[]
  transfers: Transfer[]
  harvests: Harvest[]
  monitor: MonitorResults
}

const GRAPHQL_QUERY = `query Data($chainId: Int!, $address: String!) {
  latestBlocks {
    chainId
    blockNumber
  }

  vaults {
    chainId
    address
    name
    apetaxStatus
    apetaxType
    apiVersion
    registryStatus
    tvlUsd
    tvlSparkline {
      value
      time
    }
    withdrawalQueue {
      name
      address
      netApr
    }
  }

  monitor {
    queues {
      name
      waiting
      active
      failed
    }
    db {
      databaseSize
      indexHitRate
      cacheHitRate
      clients
    }
    redis {
      uptime
      clients
      memory {
        total
        used
        peak
      }
    }
  }

  tvls(chainId: $chainId, address: $address) {
    open
    high
    low
    close
    period
    time
  }

  transfers {
    chainId
    address
    sender
    receiver
    amountUsd
    blockTimestamp
    transactionHash
  }

  harvests {
    chainId
    address
    lossUsd
    profitUsd
    blockTimestamp
    transactionHash
  }
}`

async function fetchData() {
  const response = await fetch(process.env.NEXT_PUBLIC_GQL || 'http://localhost:3001/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      query: GRAPHQL_QUERY,
      variables: { chainId: 1, address: '0xa258C4606Ca8206D8aA700cE2143D7db854D168c' }
    })
  })

  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

  return (await response.json()).data as DataContext
}

export const dataContext = createContext<DataContext>({} as DataContext)

export const useData = () => useContext(dataContext)

export default function DataProvider({children}: {children: ReactNode}) {
  const [data, setData] = useState<DataContext>({
    latestBlocks: [],
    vaults: [],
    tvls: [],
    transfers: [],
    harvests: [],
    monitor: {
      queues: [],
      db: {
        databaseSize: 0,
        indexHitRate: 0,
        cacheHitRate: 0,
        clients: 0
      },
      redis: {
        uptime: 0,
        clients: 0,
        memory: {
          total: 0,
          used: 0,
          peak: 0
        }
      }
    } as MonitorResults
  } as DataContext)

  useEffect(() => {
    let handle: NodeJS.Timeout
    const fetchAndKeepFetching = async () => {
      try {
        const data = await fetchData()
        setData(data)
      } finally {
        handle = setTimeout(fetchAndKeepFetching, 2_000)
      }
    }
    fetchAndKeepFetching()
    return () => clearTimeout(handle)
  }, [setData])

  return <dataContext.Provider value={data}>{children}</dataContext.Provider>
}