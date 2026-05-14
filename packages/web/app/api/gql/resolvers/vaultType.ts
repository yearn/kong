import {
  attachYieldSplitterMetadataToRow,
  attachYieldSplitterMetadataToRowTargeted,
  type YieldSplitterMetadata
} from '@/app/api/yieldSplitters'
import type { GraphQLResolveInfo } from 'graphql'

type TVaultResolverParent = {
  chainId?: number | null
  address?: string | null
  asset?: {
    address?: string | null
    name?: string | null
    symbol?: string | null
  } | null
  yieldSplitter?: YieldSplitterMetadata | null
}

type TGraphQLPath = {
  key: string | number
  prev?: TGraphQLPath
}

function getRootFieldName(path: TGraphQLPath): string | undefined {
  let currentPath: TGraphQLPath | undefined = path
  while (currentPath?.prev) {
    currentPath = currentPath.prev
  }

  return typeof currentPath?.key === 'string' ? currentPath.key : undefined
}

const vaultType = {
  async yieldSplitter(parent: TVaultResolverParent, _args: object, _context: object, info: GraphQLResolveInfo) {
    if (parent.yieldSplitter !== undefined) {
      return parent.yieldSplitter ?? null
    }

    if (typeof parent.chainId !== 'number' || typeof parent.address !== 'string') {
      return null
    }

    const attachMetadata = getRootFieldName(info.path) === 'vault'
      ? attachYieldSplitterMetadataToRowTargeted
      : attachYieldSplitterMetadataToRow

    const rowWithMetadata = await attachMetadata(
      parent as TVaultResolverParent & { chainId: number, address: string }
    )

    return rowWithMetadata.yieldSplitter ?? null
  }
}

export default vaultType
