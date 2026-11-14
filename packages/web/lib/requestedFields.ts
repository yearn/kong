import { GraphQLResolveInfo, Kind, SelectionSetNode } from 'graphql'

export function requestedFields(info: GraphQLResolveInfo): string[] {
  const fields = new Set<string>()
  const visit = (set?: SelectionSetNode) => set?.selections.forEach(selection => {
    if (selection.kind === Kind.FIELD) fields.add(selection.name.value)
    else if (selection.kind === Kind.INLINE_FRAGMENT) visit(selection.selectionSet)
    else visit(info.fragments[selection.name.value]?.selectionSet)
  })
  info.fieldNodes.forEach(node => visit(node.selectionSet))
  return [...fields]
}
