
export const crvVaultInsert = `
  INSERT INTO "public"."thing" ("chain_id", "address", "label", "defaults") VALUES
(1, '0xf165a634296800812B8B0607a75DeDdcD4D3cC88', 'vault', '{"asset": "0xc522A6606BBA746d7960404F22a3DB936B6F4F50", "yearn": true, "decimals": "18", "registry": "0xaF1f5e1c19cB68B30aAD73846eFfDf78a5863319", "apiVersion": "0.4.6", "inceptTime": "1742462999", "inceptBlock": "22087184"}');
`

export const crvVaultSnapshotInsert = `
INSERT INTO "public"."snapshot" ("chain_id", "address", "snapshot", "hook", "block_number", "block_time") VALUES
(1, '0xf165a634296800812B8B0607a75DeDdcD4D3cC88', '{"name": "Curve reUSD-scrvUSD Factory yVault", "token": "0xc522A6606BBA746d7960404F22a3DB936B6F4F50", "symbol": "yvCurve-reUSD-scrvUSD-f", "rewards": "0x93A62dA5a14C80f265DAbC077fCEE437B1a0Efde", "decimals": "18", "guardian": "0x2C01B4AD51a67E2d8F02208F54dF9aC4c0B778B6", "blockTime": "1752815027", "debtRatio": "10000", "totalDebt": "9381672917117052536137159", "totalIdle": "11036879581612854102139", "activation": "1742462999", "apiVersion": "0.4.6", "governance": "0xFEB4acf3df3cDEA7399794D0869ef76A6EfAff52", "lastReport": "1752793559", "management": "0x16388463d60FFE0661Cf7F1f31a7D658aC790ff7", "blockNumber": "22943875", "totalAssets": "9392709796698665390239298", "totalSupply": "8903614883038246698049646", "depositLimit": "10000000000000000000000000000000", "lockedProfit": "9933191623451568691926", "managementFee": "0", "pricePerShare": "1054370946271729476", "expectedReturn": "0", "performanceFee": "1000", "creditAvailable": "0", "debtOutstanding": "0", "DOMAIN_SEPARATOR": "0xb4f8ab09ed20020585751d66016dbad89c40aac4404afd0432f0b650c93ea0fd", "emergencyShutdown": false, "maxAvailableShares": "8908354151744620415104569", "availableDepositLimit": "9999990607290203301334609760702", "lockedProfitDegradation": "23148148148148"}', '{"apy": {"net": 0.084479478607836, "label": "apy-bwd-delta-pps", "address": "0xf165a634296800812B8B0607a75DeDdcD4D3cC88", "chainId": 1, "grossApr": 0.09018156017296361, "blockTime": "1743790619", "weeklyNet": 0.084479478607836, "monthlyNet": null, "blockNumber": "22197292", "inceptionNet": 0.044369467727764844}, "tvl": {"close": 2886196.682710157, "label": "tvl", "address": "0xf165a634296800812B8B0607a75DeDdcD4D3cC88", "chainId": 1, "blockTime": "1743379200", "component": null}, "fees": {"managementFee": 0, "performanceFee": 1000}, "meta": {"token": {"protocols": [], "description": "", "displayName": "", "displaySymbol": ""}, "protocols": [], "description": "", "displayName": "", "displaySymbol": ""}, "asset": {"name": "reUSD/scrvUSD", "symbol": "reusdscrv", "address": "0xc522A6606BBA746d7960404F22a3DB936B6F4F50", "chainId": 1, "decimals": "18"}, "debts": [], "roles": [], "sparklines": {"apy": [{"close": 0.084479478607836, "label": "apy-bwd-delta-pps", "address": "0xf165a634296800812B8B0607a75DeDdcD4D3cC88", "chainId": 1, "blockTime": "1743379200", "component": "net"}, {"close": 0.0020542057788457413, "label": "apy-bwd-delta-pps", "address": "0xf165a634296800812B8B0607a75DeDdcD4D3cC88", "chainId": 1, "blockTime": "1742774400", "component": "net"}, {"close": 0, "label": "apy-bwd-delta-pps", "address": "0xf165a634296800812B8B0607a75DeDdcD4D3cC88", "chainId": 1, "blockTime": "1742169600", "component": "net"}], "tvl": [{"close": 2886196.682710157, "label": "tvl", "address": "0xf165a634296800812B8B0607a75DeDdcD4D3cC88", "chainId": 1, "blockTime": "1743379200", "component": null}, {"close": 610138.377626424, "label": "tvl", "address": "0xf165a634296800812B8B0607a75DeDdcD4D3cC88", "chainId": 1, "blockTime": "1742774400", "component": null}, {"close": 6936.1191386175005, "label": "tvl", "address": "0xf165a634296800812B8B0607a75DeDdcD4D3cC88", "chainId": 1, "blockTime": "1742169600", "component": null}]}, "strategies": [], "withdrawalQueue": ["0x163C59dd67bBF0Dd61A1aE91E2a41f14137734b9", "0x9Df207D6b2d5e917e4a3125F2F475FAA665834BD"]}', 22943875, '2025-07-18 05:03:47+00');
`
export const crvStrategy1Insert = `
  INSERT INTO "public"."thing" ("chain_id", "address", "label", "defaults") VALUES
(1, '0x163C59dd67bBF0Dd61A1aE91E2a41f14137734b9', 'strategy', '{"name": "StrategyConvexFactory-reusdscrv", "asset": {"name": "reUSD/scrvUSD", "symbol": "reusdscrv", "address": "0xc522A6606BBA746d7960404F22a3DB936B6F4F50", "chainId": 1, "decimals": "18"}, "vault": "0xf165a634296800812B8B0607a75DeDdcD4D3cC88", "yearn": true, "decimals": "18", "apiVersion": "0.4.6", "inceptTime": "1742462999", "inceptBlock": "22087184", "debtRatio": 0, "performanceFee": 1000, "managementFee": 0}');
`

export const crvStrategy2Insert = `
INSERT INTO "public"."thing" ("chain_id", "address", "label", "defaults") VALUES
(1, '0x9Df207D6b2d5e917e4a3125F2F475FAA665834BD', 'strategy', '{"name": "StrategyCurveBoostedFactory-reusdscrv", "asset": {"name": "reUSD/scrvUSD", "symbol": "reusdscrv", "address": "0xc522A6606BBA746d7960404F22a3DB936B6F4F50", "chainId": 1, "decimals": "18"}, "vault": "0xf165a634296800812B8B0607a75DeDdcD4D3cC88", "yearn": true, "decimals": "18", "apiVersion": "0.4.6", "inceptTime": "1742462999", "inceptBlock": "22087184", "debtRatio": 10000, "performanceFee": 1000, "managementFee": 0}');
`

export const crvStrategy1SnapshotInsert = `
 INSERT INTO "public"."snapshot" ("chain_id", "address", "snapshot", "hook", "block_number", "block_time") VALUES
(1, '0x163C59dd67bBF0Dd61A1aE91E2a41f14137734b9', '{"crv": "0xD533a949740bb3306d119CC777fa900bA034cd52", "name": "StrategyConvexFactory-reusdscrv", "want": "0xc522A6606BBA746d7960404F22a3DB936B6F4F50", "vault": "0xf165a634296800812B8B0607a75DeDdcD4D3cC88", "keeper": "0x0D26E894C2371AB6D20d99A65E991775e3b5CAd7", "rewards": "0x93A62dA5a14C80f265DAbC077fCEE437B1a0Efde", "isActive": false, "blockTime": "1743790559", "apiVersion": "0.4.6", "curveVoter": "0x0000000000000000000000000000000000000000", "isOriginal": false, "strategist": "0x16388463d60FFE0661Cf7F1f31a7D658aC790ff7", "blockNumber": "22197287", "healthCheck": "0xDDCea799fF1699e98EDF118e0629A974Df7DF012", "metadataURI": "", "localKeepCRV": "0", "tradeFactory": "0xb634316E06cC0B358437CbadD4dC94F1D3a92B3b", "balanceOfWant": "0", "baseFeeOracle": "0xfeCA6895DcF50d6350ad0b5A8232CF657C316dA7", "doHealthCheck": true, "emergencyExit": false, "stakedBalance": "0", "maxReportDelay": "345600", "minReportDelay": "0", "creditThreshold": "10000000000000000000000", "delegatedAssets": "0", "isBaseFeeAcceptable": true, "estimatedTotalAssets": "0", "forceHarvestTriggerOnce": false}', '{"meta": {"protocols": [], "description": "", "displayName": ""}, "claims": [{"name": "Curve DAO Token", "symbol": "CRV", "address": "0xD533a949740bb3306d119CC777fa900bA034cd52", "balance": "262773857256184829", "chainId": 1, "decimals": "18", "balanceUsd": 0.13270132880000002}, {"name": "Convex Token", "symbol": "CVX", "address": "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B", "balance": "8486290057323233869", "chainId": 1, "decimals": "18", "balanceUsd": 17.39671}], "totalDebt": "0", "totalDebtUsd": 0, "lenderStatuses": [], "lastReportDetail": {"apr": {"net": 0, "gross": 0}, "loss": "0", "profit": "0", "address": "0x163C59dd67bBF0Dd61A1aE91E2a41f14137734b9", "chainId": 1, "lossUsd": 0, "blockTime": "1743057347", "profitUsd": 0, "blockNumber": "22136492", "debtPayment": "47191748025193812951671", "debtPaymentUsd": 0, "debtOutstanding": "0", "transactionHash": "0xf06dae52e5c27d194f5a65f53decd0fa87e572fedb5b824405f7f40d7fe6cb37", "debtOutstandingUsd": 0}}', 22197287, '2025-04-04 18:15:59+00');
`

export const crvStrategy2SnapshotInsert = `
INSERT INTO "public"."snapshot" ("chain_id", "address", "snapshot", "hook", "block_number", "block_time") VALUES
(1, '0x9Df207D6b2d5e917e4a3125F2F475FAA665834BD', '{"crv": "0xD533a949740bb3306d119CC777fa900bA034cd52", "name": "StrategyCurveBoostedFactory-reusdscrv", "want": "0xc522A6606BBA746d7960404F22a3DB936B6F4F50", "gauge": "0xaF01d68714E7eA67f43f08b5947e367126B889b1", "proxy": "0x78eDcb307AC1d1F8F5Fd070B377A6e69C8dcFC34", "vault": "0xf165a634296800812B8B0607a75DeDdcD4D3cC88", "keeper": "0x0D26E894C2371AB6D20d99A65E991775e3b5CAd7", "rewards": "0x93A62dA5a14C80f265DAbC077fCEE437B1a0Efde", "isActive": true, "blockTime": "1743790559", "apiVersion": "0.4.6", "curveVoter": "0xF147b8125d2ef93FB6965Db97D6746952a133934", "isOriginal": false, "strategist": "0x16388463d60FFE0661Cf7F1f31a7D658aC790ff7", "blockNumber": "22197287", "healthCheck": "0xDDCea799fF1699e98EDF118e0629A974Df7DF012", "metadataURI": "", "localKeepCRV": "0", "tradeFactory": "0xb634316E06cC0B358437CbadD4dC94F1D3a92B3b", "balanceOfWant": "2187743408971746866778", "baseFeeOracle": "0xfeCA6895DcF50d6350ad0b5A8232CF657C316dA7", "doHealthCheck": true, "emergencyExit": false, "stakedBalance": "2900545682247319133712717", "maxReportDelay": "3153600000", "minReportDelay": "172800", "creditThreshold": "10000000000000000000000", "delegatedAssets": "0", "isBaseFeeAcceptable": true, "estimatedTotalAssets": "2902733425656290880579495", "forceHarvestTriggerOnce": false}', '{"meta": {"protocols": [], "description": "", "displayName": ""}, "claims": [{"name": "Curve DAO Token", "symbol": "CRV", "address": "0xD533a949740bb3306d119CC777fa900bA034cd52", "balance": "1", "chainId": 1, "decimals": "18", "balanceUsd": 0}], "totalDebt": "2900545682247319133712717", "totalDebtUsd": 2886196.682710157, "lenderStatuses": [], "lastReportDetail": {"apr": {"net": 0, "gross": 0}, "loss": "0", "profit": "0", "address": "0x9Df207D6b2d5e917e4a3125F2F475FAA665834BD", "chainId": 1, "lossUsd": 0, "blockTime": "1743760979", "profitUsd": 0, "blockNumber": "22194833", "debtPayment": "0", "debtPaymentUsd": 0, "debtOutstanding": "0", "transactionHash": "0x0000000000000000000000000000000000000000000000000000000000000000"}}', 22197287, '2024-01-31T12:00:00Z');
`

// Mock HTTP responses for Curve API calls
export const mockGaugeData = {
  '0xaF01d68714E7eA67f43f08b5947e367126B889b1': {
    'swap': '0x0CD6f267b2086bea681E922E19D40512511BE538',
    'swap_token': '0xc522A6606BBA746d7960404F22a3DB936B6F4F50',
    'gauge': '0xaF01d68714E7eA67f43f08b5947e367126B889b1',
    'lpTokenPrice': 1.0012,
    'swap_data': {
      'virtual_price': '1001200000000000000'
    },
    'gauge_data': {
      'working_supply': '2900545682247319133712717'
    },
    'gauge_controller': {
      'inflation_rate': '5000000000000000',
      'gauge_relative_weight': '1000000000000000'
    }
  }
}

export const mockPoolData = {
  'poolData': [{
    'id': 'factory-stable-ng-146',
    'address': '0x0CD6f267b2086bea681E922E19D40512511BE538',
    'lpTokenAddress': '0xc522A6606BBA746d7960404F22a3DB936B6F4F50',
    'gaugeAddress': '0xaF01d68714E7eA67f43f08b5947e367126B889b1',
    'gaugeRewards': [{
      'gaugeAddress': '0xaF01d68714E7eA67f43f08b5947e367126B889b1',
      'tokenAddress': '0xD533a949740bb3306d119CC777fa900bA034cd52',
      'symbol': 'CRV',
      'APY': 2.5
    }]
  }]
}

export const mockSubgraphData = {
  'data': {
    'poolList': [{
      'address': '0x0CD6f267b2086bea681E922E19D40512511BE538',
      'latestWeeklyApy': 8.5,
      'latestDailyApy': 8.2
    }]
  }
}

export const mockFraxPoolData = {
  'pools': {
    'augmentedPoolData': []
  }
}

// Mock contract call responses
export const mockContractCalls = {
  // Strategy keepCRV calls
  keepCRV: '0',
  keepCRVPercentage: '0',

  // Gauge boost calculation
  gaugeBoost: '2500000000000000000', // 2.5x boost

  // CVX Booster poolInfo
  poolInfo: {
    lptoken: '0xc522A6606BBA746d7960404F22a3DB936B6F4F50',
    token: '0xc522A6606BBA746d7960404F22a3DB936B6F4F50',
    gauge: '0xaF01d68714E7eA67f43f08b5947e367126B889b1',
    crvRewards: '0x7091dbb7fcbA54569eF1387Ac89Eb2a5C9F6d2EA',
    stash: '0x0000000000000000000000000000000000000000',
    shutdown: false
  },

  // CRV rewards contract
  rewardRate: '1000000000000000000', // 1 CRV per second
  totalSupply: '2900545682247319133712717',

  // Price data
  crvPrice: 0.505,
  cvxPrice: 2.05,
  assetPrice: 1.0012
}

export const mockSubgraphDataEthereum = {
  'data': {
    'poolList': [{
      'address': '0x0CD6f267b2086bea681E922E19D40512511BE538',
      'latestWeeklyApy': 8.5,
      'latestDailyApy': 8.2
    }]
  }
}

// Mock environment variables
export const mockEnvVars = {
  CRV_GAUGE_REGISTRY_URL: 'https://api.curve.fi/api/getGauges',
  CRV_POOLS_URL: 'https://api.curve.fi/api/getPools',
  YDAEMON_API: 'https://ydaemon.yearn.fi/1'
}


