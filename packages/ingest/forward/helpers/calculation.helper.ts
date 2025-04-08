
export function convertFloatAPRToAPY(apr: bigint, periodsPerYear: number): number {
  // Convert APR to decimal form
  const aprDecimal = Number(apr) / 100.0

  // APY = (1 + r/n)^n - 1
  // where r is the APR in decimal form and n is the number of compounding periods
  const apy = Math.pow(1 + (aprDecimal / periodsPerYear), periodsPerYear) - 1

  // Convert back to percentage
  return apy * 100
}
