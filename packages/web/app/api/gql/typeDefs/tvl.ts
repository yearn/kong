import gql from 'graphql-tag'

export default gql`
type Tvl {
  chainId: Int!
  address: String!
  value: Float!
  priceUsd: Float
  priceSource: String!
  period: String!
  blockNumber: Int!
  time: BigInt
}
`
