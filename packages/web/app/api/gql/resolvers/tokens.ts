import db from '@/app/api/db'

const tokens = async (_: object, args: { chainId?: number }) => {
  const { chainId } = args

  try {
    const result = await db.query(`
    SELECT defaults FROM thing WHERE label = 'erc20';`)

    return result.rows
      .map(row => row.defaults)
      .filter(defaults => !chainId || defaults.chainId === chainId)
      .sort((a, b) => {
        if (a.chainId !== b.chainId) return a.chainId - b.chainId
        return (a.name || '').localeCompare(b.name || '')
      })
      .map(defaults => ({
        chainId: defaults.chainId,
        address: defaults.address,
        name: defaults.name,
        symbol: defaults.symbol,
        decimals: defaults.decimals
      }))

  } catch (error) {
    console.error(error)
    throw new Error('!tokens')
  }
}

export default tokens