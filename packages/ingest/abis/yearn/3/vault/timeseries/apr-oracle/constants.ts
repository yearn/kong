export interface OracleConfig {
  address: `0x${string}`;
  inceptBlock: number;
}

export const ORACLE_ADDRESSES: Record<number, OracleConfig> = {
  1: {
    address: '0x1981AD9F44F2EA9aDd2dC4AD7D075c102C70aF92',
    inceptBlock: 20980809,
  },
  250: {
    address: '0x1981AD9F44F2EA9aDd2dC4AD7D075c102C70aF92',
    inceptBlock: 307797,
  },
  10: {
    address: '0x1981AD9F44F2EA9aDd2dC4AD7D075c102C70aF92',
    inceptBlock: 126847323,
  },
  137: {
    address: '0x1981AD9F44F2EA9aDd2dC4AD7D075c102C70aF92',
    inceptBlock: 63167152,
  },
  8453: {
    address: '0x1981AD9F44F2EA9aDd2dC4AD7D075c102C70aF92',
    inceptBlock: 22063855,
  },
  42161: {
    address: '0x1981AD9F44F2EA9aDd2dC4AD7D075c102C70aF92',
    inceptBlock: 265347717,
  },
}

export function getOracleConfig(chainId: number): OracleConfig | undefined {
  return ORACLE_ADDRESSES[chainId]
}
