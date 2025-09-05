import bananas from './bananas'
import latestBlocks from './latestBlocks'
import monitor from './monitor'
import vaults from './vaults'
import vault from './vault'
import strategies from './strategies'
import transfers from './transfers'
import deposits from './deposits'
import timeseries from './timeseries'
import { bigintScalar } from './bigintScalar'
import accountRoles from './accountRoles'
import accountVaults from './accountVaults'
import accountStrategies from './accountStrategies'
import vaultReports from './vaultReports'
import strategyReports from './strategyReports'
import strategy from './strategy'
import riskScores from './riskScores' // LEGACY
import vaultStrategies from './vaultStrategies'
import vaultAccounts from './vaultAccounts'
import prices from './prices'
import projects from './projects'
import accountants from './accountants'
import accountant from './accountant'
import things from './things'
import tokens from './tokens'
import tvls from './tvls'
import allocator from './allocator'
import newSplitterLogs from './splitter'
import newYieldSplitterLogs from './yieldSplitter'
import vestingEscrowCreatedLogs from './vestingEscrow'

const resolvers = {
  BigInt: bigintScalar,
  Query: {
    bananas,
    latestBlocks,
    monitor,
    vaults,
    vault,
    vaultAccounts,
    vaultReports,
    vaultStrategies,
    prices,
    projects,
    riskScores, // LEGACY
    strategies,
    strategy,
    strategyReports,
    transfers,
    deposits,
    timeseries,
    tvls,
    accountRoles,
    accountVaults,
    accountStrategies,
    accountants,
    accountant,
    allocator,
    things,
    tokens,
    newSplitterLogs,
    newYieldSplitterLogs,
    vestingEscrowCreatedLogs
  }
}

export default resolvers
