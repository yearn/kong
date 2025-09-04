import gql from 'graphql-tag'
import lib from './lib'
import vault from './vault'
import output from './output'
import strategy from './strategy'
import transfer from './transfer'
import deposit from './deposit'
import latestBlock from './latestBlock'
import monitor from './monitor'
import accountRole from './accountRole'
import vaultReport from './vaultReport'
import strategyReport from './strategyReport'
import price from './price'
import accountant from './accountant'
import thing from './thing'
import tvl from './tvl'
import allocator from './allocator'
import project from './project'
import roleManager from './roleManager'
import { newSplitterLog } from './splitter'
import { newYieldSplitterLog } from './yieldSplitter'
import { vestingEscrowCreatedLog } from './vestingEscrow'

const query = gql`
  scalar BigInt

  enum CacheControlScope {
    PUBLIC
    PRIVATE
  }

  directive @cacheControl(
    maxAge: Int
    scope: CacheControlScope
    inheritMaxAge: Boolean
  ) on FIELD_DEFINITION | OBJECT | INTERFACE | UNION

  type Query {
    bananas: String @cacheControl(maxAge: 0)
    latestBlocks(chainId: Int): [LatestBlock] @cacheControl(maxAge: 2)
    monitor: Monitor @cacheControl(maxAge: 2)
    allocator(chainId: Int!, vault: String!): Allocator
    vaults(chainId: Int, apiVersion: String, erc4626: Boolean, v3: Boolean, yearn: Boolean, addresses: [String], vaultType: Int, riskLevel: Int, unratedOnly: Boolean): [Vault]
    vault(chainId: Int, address: String): Vault
    vaultAccounts(chainId: Int, vault: String): [AccountRole]
    vaultReports(chainId: Int, address: String): [VaultReport]
    vaultStrategies(chainId: Int, vault: String): [Strategy]
    prices(chainId: Int, address: String, timestamp: BigInt): [Price]
    projects(chainId: Int): [Project]
    riskScores: [RiskScoreLegacy]
    strategies(chainId: Int, apiVersion: String, erc4626: Boolean): [Strategy]
    strategy(chainId: Int, address: String): Strategy
    strategyReports(chainId: Int, address: String): [StrategyReport]
    transfers(chainId: Int, address: String): [Transfer]
    deposits(chainId: Int, address: String): [Deposit]
    timeseries(chainId: Int, address: String, label: String!, component: String, period: String, limit: Int, timestamp: BigInt, yearn: Boolean): [Output]
    tvls(chainId: Int!, address: String, period: String, limit: Int, timestamp: BigInt): [Tvl]
    accountRoles(chainId: Int, account: String!): [AccountRole]
    accountVaults(chainId: Int, account: String!): [Vault]
    accountStrategies(chainId: Int, account: String!): [Strategy]
    accountants(chainId: Int): [Accountant]
    accountant(chainId: Int!, address: String!): Accountant
    things(chainId: Int, labels: [String]!): [Thing]
    tokens(chainId: Int): [Erc20]
    newSplitterLogs(chainId: Int, address: String, splitter: String, manager: String, managerRecipient: String): [NewSplitterLog]
    newYieldSplitterLogs(chainId: Int, address: String, splitter: String, vault: String, want: String): [NewYieldSplitterLog]
    vestingEscrowCreatedLogs(recipient: String): [VestingEscrowCreatedLog]
  }
`

const typeDefs = [
  query,
  lib,
  allocator,
  vault,
  vaultReport,
  strategy,
  strategyReport,
  transfer,
  deposit,
  output,
  tvl,
  price,
  latestBlock,
  monitor,
  accountRole,
  accountant,
  thing,
  project,
  roleManager,
  newSplitterLog,
  newYieldSplitterLog,
  vestingEscrowCreatedLog
]

export default typeDefs
