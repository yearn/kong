import gql from "graphql-tag";

export default gql`
  type Error {
    queue: String!
    stacktrace: String!
    failedReason: String
    data: JSON!
  }
`;
