import gql from 'graphql-tag'

export const newYieldSplitterLog = gql`
type NewYieldSplitterLog {
  chainId: Int!
  address: String!
  splitter: String!
  vault: String!
  want: String!
}
`
