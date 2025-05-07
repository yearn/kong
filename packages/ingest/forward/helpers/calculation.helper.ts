export function convertFloatAPRToAPY(apr: number, periodsPerYear: number): number {
  // Convert APR to decimal form (div by 100 to convert percentage to decimal)
  const aprDecimal = apr / 100.0

  // APY = (1 + r/n)^n - 1
  // where r is the APR in decimal form and n is the number of compounding periods
  const apy = Math.pow(1 + (aprDecimal / periodsPerYear), periodsPerYear) - 1

  // Convert back to percentage
  return apy * 100
}

export function toNormalizedAmount(amount: bigint, decimals: number): number {
  // Convert amount to a number and divide by 10^decimals
  return Number(amount) / Math.pow(10, decimals)
}

