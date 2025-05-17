import { Thing } from 'lib/types'

export function isV3Vault(vault: Thing): boolean {
  const versionMajor = vault.defaults.apiVersion.split('.')[0]
  return versionMajor === '3' || versionMajor === '~3'
}
