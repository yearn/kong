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
  100: {
    address: '0x1981AD9F44F2EA9aDd2dC4AD7D075c102C70aF92',
    inceptBlock: 36654351,
  },
  137: {
    address: '0x1981AD9F44F2EA9aDd2dC4AD7D075c102C70aF92',
    inceptBlock: 63167152,
  },
  146: {
    address: '0x1981AD9F44F2EA9aDd2dC4AD7D075c102C70aF92',
    inceptBlock:307797,
  },
  8453: {
    address: '0x1981AD9F44F2EA9aDd2dC4AD7D075c102C70aF92',
    inceptBlock: 22063855,
  },
  42161: {
    address: '0x1981AD9F44F2EA9aDd2dC4AD7D075c102C70aF92',
    inceptBlock: 265347717,
  },
  80094: {
    address: '0x1981AD9F44F2EA9aDd2dC4AD7D075c102C70aF92',
    inceptBlock: 827653,
  },
  747474: {
    address: '0x1981AD9F44F2EA9aDd2dC4AD7D075c102C70aF92',
    inceptBlock: 2237016
  }
}

export function getOracleConfig(chainId: number): OracleConfig | undefined {
  return ORACLE_ADDRESSES[chainId]
}
