import { gql } from 'apollo-server-express'
import latestBlock from './latestBlock'
import strategy from './strategy'
import vault from './vault'
import monitorResults from './monitorResults'
import sparklineItem from './sparklineItem'
import tvl from './tvl'
import transfer from './transfer'
import harvest from './harvest'
import fail from './fail'
import apy from './apy'
import period from './period'

const query = gql`
  scalar BigInt

  type Query {
    bananas: String,
    latestBlocks(chainId: Int): [LatestBlock],
    vaults(chainId: Int): [Vault],
    vault(chainId: Int!, address: String!): Vault,
    tvls(chainId: Int!, address: String!, period: Period, limit: Int): [Tvl],
    apys(chainId: Int!, address: String!, period: Period, limit: Int): [Apy],
    harvests(chainId: Int, address: String): [Harvest],
    transfers(chainId: Int, address: String): [Transfer],
    monitor: MonitorResults,
    fail(queueName: String!): [Fail]
  }
`

export default [
  query,
  latestBlock, 
  sparklineItem,
  period,
  tvl,
  apy,
  strategy, 
  vault, 
  monitorResults,
  harvest,
  transfer,
  fail
]
