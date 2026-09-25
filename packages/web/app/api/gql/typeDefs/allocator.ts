import gql from 'graphql-tag'

export default gql`
type Allocator {
  chainId: Int!
  address: String!
  vault: String!
}
`
