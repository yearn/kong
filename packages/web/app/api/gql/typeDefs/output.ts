import gql from 'graphql-tag'

export default gql`
type Output {
  chainId: Int!
  address: String!
  label: String!
  component: String
  value: Float!
  period: String!
  time: BigInt
}
`
