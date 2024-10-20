import gql from 'graphql-tag'

export default gql`
type RoleManager {
  chainId: Int!
  address: String!
  roleManagerFactory: String!
  project: Project!
  chad: String!
  defaultProfitMaxUnlock: BigInt!
  accountant: String!
  allocatorFactory: String!
  brain: String!
  brainRoles: BigInt!
  daddy: String!
  daddyRoles: BigInt!
  debtAllocator: String!
  debtAllocatorRoles: BigInt!
  keeper: String!
  keeperRoles: BigInt!
  registry: String!
  security: String!
  securityRoles: BigInt!
  strategyManager: String!
  strategyManagerRoles: BigInt!
  governance: String!
  pendingGovernance: String!
}
`
