import gql from 'graphql-tag'

export default gql`
type Project {
  chainId: Int!
  id: String!
  name: String!
  roleManager: String!
  registry: String!
  accountant: String!
  debtAllocator: String!
}
`
