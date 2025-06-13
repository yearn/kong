import gql from 'graphql-tag'

export const newSplitterLog = gql`
type NewSplitterLog {
  chainId: Int!
  address: String!
  splitter: String!
  manager: String!
  managerRecipient: String!
  splitee: String!
}
`
