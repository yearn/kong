import gql from 'graphql-tag'

export default gql`
type Monitor {
  queues: [QueueStatus]
  redis: RedisInfo!
  db: DbInfo!,
  ingest: IngestInfo!
  indexStatsJson: String!
}

type QueueStatus {
  name: String!
  waiting: Int!
  active: Int!
  failed: Int!
}

type RedisMemory {
  total: BigInt!
  used: BigInt!
  peak: BigInt!
  fragmentation: Float!
}

type RedisInfo {
  version: String!
  mode: String
  os: String!
  uptime: Int!
  clients: Int!
  memory: RedisMemory!
}

type DbInfo {
  clients: Int!
  databaseSize: BigInt!
  indexHitRate: Float!
  cacheHitRate: Float!
}

type NetworkStat {
  chainId: Int!
  count: Int!
}

type ApetaxStat {
  stealth: Int!
  new: Int!
  active: Int!
  withdraw: Int!
}

type IngestCpu {
  usage: Float!
}

type IngestMemory {
  total: BigInt!
  used: BigInt!
}

type IngestInfo {
  cpu: IngestCpu!
  memory: IngestMemory!
}
`
