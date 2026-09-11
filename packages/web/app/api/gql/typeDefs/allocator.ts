import gql from 'graphql-tag'

export default gql`
type AllocatorState {
  schemaVersion: Int!
  address: String
  status: String!
  reason: String
  family: String
  support: String
  roleManagerAddress: String
  assignmentId: String
  deploymentSourceEventId: String
  revision: String
  sourceRevision: String
  asOfBlock: Int
  blockHash: String
  observedAt: String
  stale: Boolean
  lastAttemptAt: String
  lastError: String
}

type Allocator {
  chainId: Int!
  address: String
  vault: String!
  state: AllocatorState!
}
`
