export const YEARN_VOTER_ADDRESS: Record<number, `0x${string}`> = {
  1: '0xF147b8125d2ef93FB6965Db97D6746952a133934',
  10: '0xea3a15df68fcdbe44fdb0db675b2b3a14a148b26',
  250: '0x72a34AbafAB09b15E7191822A679f28E067C4a16',
  8453: '0x', // TODO: ADD YEARN_VOTER_ADDRESS FOR BASE
  42161: '0x6346282DB8323A54E840c6C772B4399C9c655C0d',
}

export const CONVEX_VOTER_ADDRESS: Record<number, `0x${string}`> = {
  1: '0x989AEb4d175e16225E39E87d0D97A3360524AD80',
  10: '0x',
  137: '0x',
  250: '0x',
  8453: '0x',
  42161: '0x',
}

export const CVX_BOOSTER_ADDRESS: Record<number, `0x${string}`> = {
  1: '0xF403C135812408BFbE8713b5A23a04b3D48AAE31',
  10: '0x',
  137: '0x',
  250: '0x',
  8453: '0x',
  42161: '0x',
}

export const CRV_TOKEN_ADDRESS: Record<number, `0x${string}`> = {
  1: '0xD533a949740bb3306d119CC777fa900bA034cd52',
  10: '0x0994206dfE8De6Ec6920FF4D779B0d950605Fb53',
  137: '0x172370d5Cd63279eFa6d502DAB29171933a610AF',
  250: '0x1E4F97b9f9F913c46F1632781732927B9019C68b',
  8453: '0x', // TODO: ADD CRV_TOKEN_ADDRESS FOR BASE
  42161: '0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978',
}

export const CVX_TOKEN_ADDRESS: Record<number, `0x${string}`> = {
  1: '0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B',
  10: '0x',
  137: '0x',
  250: '0x',
  8453: '0x',
  42161: '0x',
}

// CURVE_SUBGRAPHDATA_URI contains the URI of the Curve gauges to use
export const CURVE_SUBGRAPHDATA_URI: Record<number, string> = {
  1: 'https://api.curve.fi/api/getSubgraphData/ethereum',
  10: 'https://api.curve.fi/api/getSubgraphData/optimism',
  137: 'https://api.curve.fi/api/getSubgraphData/polygon',
  250: 'https://api.curve.fi/api/getSubgraphData/fantom',
  8453: '', // TODO: ADD CURVE_SUBGRAPHDATA_URI FOR BASE
  42161: 'https://api.curve.fi/api/getSubgraphData/arbitrum',
}
