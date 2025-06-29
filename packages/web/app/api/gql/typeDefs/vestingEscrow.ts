import gql from 'graphql-tag'

export const vestingEscrowCreatedLog = gql`
type VestingEscrowCreatedLog {
  chainId: Int!
  funder: String!
  token: Erc20!
  recipient: String!
  escrow: String!
  amount: BigInt!
  vestingStart: BigInt!
  vestingDuration: BigInt!
  cliffLength: BigInt!
  openClaim: Boolean!
}
`
