import { CompareOperator, compare, validate } from 'compare-versions'
import { clean } from 'lib/version'

export function classifyVault(apiVersion: string) {
  const cleaned = clean(apiVersion)
  if (!validate(cleaned)) return undefined

  return {
    yearn: true,
    v3: compare(cleaned, '3.0.0', '>=' as CompareOperator),
    apiVersion
  }
}
