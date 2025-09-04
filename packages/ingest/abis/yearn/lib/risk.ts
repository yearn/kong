import { cache } from 'lib'
import { RiskScore, RiskScoreSchema } from 'lib/types'

export async function getRiskScore(chainId: number, address: `0x${string}`): Promise<RiskScore | undefined> {
  return cache.wrap(`abis/yearn/lib/risk/${chainId}/${address.toLowerCase()}`, async () => {
    return await fetchRiskScore(chainId, address)
  }, 5 * 60 * 1000)
}

async function fetchRiskScore(chainId: number, address: `0x${string}`): Promise<RiskScore | undefined> {
  try {
    const baseUrl = process.env.RISK_CDN_URL || 'https://risk.yearn.fi'
    const url = `${baseUrl}/cdn/vaults/${chainId}/${address.toLowerCase()}.json`
    const response = await fetch(url)

    if (!response.ok) {
      console.warn('⚠️', '!risk, status code', response.status, chainId, address)
      return undefined
    }

    const json = await response.json()
    return RiskScoreSchema.parse(json)
  } catch (error) {
    console.warn('⚠️', '!risk', error, chainId, address)
    return undefined
  }
}
