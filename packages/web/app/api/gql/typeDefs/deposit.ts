import gql from 'graphql-tag'

export default gql`
type Deposit {
  amount: String!
  shares: String!
  recipient: String!
}
`