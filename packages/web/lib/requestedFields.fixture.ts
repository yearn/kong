import { FieldNode, FragmentDefinitionNode, GraphQLResolveInfo, Kind, OperationDefinitionNode, parse } from 'graphql'

export const infoFor = (source: string) => {
  const document = parse(source)
  const operation = document.definitions.find(d => d.kind === Kind.OPERATION_DEFINITION) as OperationDefinitionNode
  const fragments = Object.fromEntries(document.definitions
    .filter((d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION)
    .map(d => [d.name.value, d]))
  return { fieldNodes: operation.selectionSet.selections as FieldNode[], fragments } as unknown as GraphQLResolveInfo
}
