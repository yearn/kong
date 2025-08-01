import gql from 'graphql-tag'

export default gql`
type Deposit {
  chainId: Int!
  vaultAddress: String!
  amount: String!
  shares: String!
  recipient: String!
}
`