// Per-block price table data was yDaemon spot snapshots at ingestion time, not
// historical prices. Unconditionally empty; consumers should use prices.yearn.dev.
// Schema field retained for compatibility (sunset is a follow-up).
const prices = async (
  _: object,
  _args: { chainId?: number, address?: `0x${string}`, timestamp?: bigint }
) => {
  return []
}

export default prices
