'use client'

import { ReactNode, createContext, useContext, useEffect, useState } from 'react'
import { DEFAULT_CONTEXT, DataContext, DataContextSchema } from './types'
import useSWR from 'swr'

const endpoint = process.env.NEXT_PUBLIC_GQL || '/api/gql'

const STATUS_QUERY = `query Data {
  latestBlocks {
    chainId
    blockNumber
  }

  monitor {
    queues {
      name
      waiting
      active
      failed
    }

    redis {
      version
      mode
      os
      uptime
      clients
      memory {
        total
        used
        peak
        fragmentation
      }
    }

    db {
      clients
      databaseSize
      indexHitRate
      cacheHitRate
    }

    ingest {
      cpu {
        usage
      }
      memory {
        total
        used
      }
    }

    indexStatsJson
  }
}`

export const dataContext = createContext<DataContext>(DEFAULT_CONTEXT)

export const useData = () => useContext(dataContext)

export default function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DataContext>(DEFAULT_CONTEXT)

  const { data: status } = useSWR(
    `${endpoint}?status`,
    (...args) => fetch(...args, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: STATUS_QUERY
      })
    }).then(res => res.json()).catch(reason => {
      console.error(reason)
      return {}
    }),
    { refreshInterval: parseInt(process.env.NEXT_PUBLIC_DASH_REFRESH || '10_000') }
  )

  useEffect(() => {
    // Filter out null values from GraphQL response to preserve defaults
    const responseData = status?.data || {}
    const filteredData = Object.fromEntries(
      Object.entries(responseData).filter(([_, value]) => value !== null)
    )

    const update = DataContextSchema.parse({
      ...DEFAULT_CONTEXT,
      ...filteredData
    })
    setData(update)
  }, [status, setData])

  return <dataContext.Provider value={data}>{children}</dataContext.Provider>
}
