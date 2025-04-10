export const yprismaReceiverAbi = [
  {
    'inputs': [
      { 'internalType': 'contract IERC20', 'name': '_prisma', 'type': 'address' },
      { 'internalType': 'contract IERC20', 'name': '_CRV', 'type': 'address' },
      { 'internalType': 'contract IERC20', 'name': '_CVX', 'type': 'address' },
      { 'internalType': 'contract IBooster', 'name': '_booster', 'type': 'address' },
      { 'internalType': 'contract ICurveProxy', 'name': '_proxy', 'type': 'address' },
      { 'internalType': 'contract IPrismaVault', 'name': '_vault', 'type': 'address' },
      { 'internalType': 'address', 'name': 'prismaCore', 'type': 'address' }
    ],
    'stateMutability': 'nonpayable',
    'type': 'constructor'
  },
  {
    'anonymous': false,
    'inputs': [
      { 'indexed': true, 'internalType': 'address', 'name': 'owner', 'type': 'address' },
      { 'indexed': true, 'internalType': 'address', 'name': 'spender', 'type': 'address' },
      { 'indexed': false, 'internalType': 'uint256', 'name': 'value', 'type': 'uint256' }
    ],
    'name': 'Approval',
    'type': 'event'
  },
  {
    'anonymous': false,
    'inputs': [
      { 'indexed': true, 'internalType': 'address', 'name': 'lpToken', 'type': 'address' },
      { 'indexed': true, 'internalType': 'address', 'name': 'receiver', 'type': 'address' },
      { 'indexed': false, 'internalType': 'uint256', 'name': 'amount', 'type': 'uint256' }
    ],
    'name': 'LPTokenDeposited',
    'type': 'event'
  },
  {
    'anonymous': false,
    'inputs': [
      { 'indexed': true, 'internalType': 'address', 'name': 'lpToken', 'type': 'address' },
      { 'indexed': true, 'internalType': 'address', 'name': 'receiver', 'type': 'address' },
      { 'indexed': false, 'internalType': 'uint256', 'name': 'amount', 'type': 'uint256' }
    ],
    'name': 'LPTokenWithdrawn',
    'type': 'event'
  },
  {
    'anonymous': false,
    'inputs': [
      { 'indexed': false, 'internalType': 'uint256', 'name': 'pct', 'type': 'uint256' }
    ],
    'name': 'MaxWeeklyEmissionPctSet',
    'type': 'event'
  },
  {
    'anonymous': false,
    'inputs': [
      { 'indexed': false, 'internalType': 'uint256', 'name': 'allocated', 'type': 'uint256' },
      { 'indexed': false, 'internalType': 'uint256', 'name': 'maxAllowed', 'type': 'uint256' }
    ],
    'name': 'MaxWeeklyEmissionsExceeded',
    'type': 'event'
  },
  {
    'anonymous': false,
    'inputs': [
      { 'indexed': true, 'internalType': 'address', 'name': 'receiver', 'type': 'address' },
      { 'indexed': false, 'internalType': 'uint256', 'name': 'prismaAmount', 'type': 'uint256' },
      { 'indexed': false, 'internalType': 'uint256', 'name': 'crvAmount', 'type': 'uint256' },
      { 'indexed': false, 'internalType': 'uint256', 'name': 'cvxAmount', 'type': 'uint256' }
    ],
    'name': 'RewardClaimed',
    'type': 'event'
  },
  {
    'anonymous': false,
    'inputs': [
      { 'indexed': true, 'internalType': 'address', 'name': 'from', 'type': 'address' },
      { 'indexed': true, 'internalType': 'address', 'name': 'to', 'type': 'address' },
      { 'indexed': false, 'internalType': 'uint256', 'name': 'value', 'type': 'uint256' }
    ],
    'name': 'Transfer',
    'type': 'event'
  },
  {
    'inputs': [],
    'name': 'CRV',
    'outputs': [{ 'internalType': 'contract IERC20', 'name': '', 'type': 'address' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'CVX',
    'outputs': [{ 'internalType': 'contract IERC20', 'name': '', 'type': 'address' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'PRISMA',
    'outputs': [{ 'internalType': 'contract IERC20', 'name': '', 'type': 'address' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'PRISMA_CORE',
    'outputs': [{ 'internalType': 'contract IPrismaCore', 'name': '', 'type': 'address' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [
      { 'internalType': 'address', 'name': '', 'type': 'address' },
      { 'internalType': 'address', 'name': '', 'type': 'address' }
    ],
    'name': 'allowance',
    'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [
      { 'internalType': 'address', 'name': '_spender', 'type': 'address' },
      { 'internalType': 'uint256', 'name': '_value', 'type': 'uint256' }
    ],
    'name': 'approve',
    'outputs': [{ 'internalType': 'bool', 'name': '', 'type': 'bool' }],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [{ 'internalType': 'address', 'name': '', 'type': 'address' }],
    'name': 'balanceOf',
    'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'booster',
    'outputs': [{ 'internalType': 'contract IBooster', 'name': '', 'type': 'address' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [{ 'internalType': 'address', 'name': 'receiver', 'type': 'address' }],
    'name': 'claimReward',
    'outputs': [
      { 'internalType': 'uint256', 'name': 'prismaAmount', 'type': 'uint256' },
      { 'internalType': 'uint256', 'name': 'crvAmount', 'type': 'uint256' },
      { 'internalType': 'uint256', 'name': 'cvxAmount', 'type': 'uint256' }
    ],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [{ 'internalType': 'address', 'name': 'account', 'type': 'address' }],
    'name': 'claimableReward',
    'outputs': [
      { 'internalType': 'uint256', 'name': 'prismaAmount', 'type': 'uint256' },
      { 'internalType': 'uint256', 'name': 'crvAmount', 'type': 'uint256' },
      { 'internalType': 'uint256', 'name': 'cvxAmount', 'type': 'uint256' }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'crvRewards',
    'outputs': [{ 'internalType': 'contract IBaseRewardPool', 'name': '', 'type': 'address' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'curveProxy',
    'outputs': [{ 'internalType': 'contract ICurveProxy', 'name': '', 'type': 'address' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'cvxRewards',
    'outputs': [{ 'internalType': 'contract IBaseRewardPool', 'name': '', 'type': 'address' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'decimals',
    'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [
      { 'internalType': 'address', 'name': 'receiver', 'type': 'address' },
      { 'internalType': 'uint256', 'name': 'amount', 'type': 'uint256' }
    ],
    'name': 'deposit',
    'outputs': [{ 'internalType': 'bool', 'name': '', 'type': 'bool' }],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'depositPid',
    'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'emissionId',
    'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'fetchRewards',
    'outputs': [],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'guardian',
    'outputs': [{ 'internalType': 'address', 'name': '', 'type': 'address' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [{ 'internalType': 'uint256', 'name': 'pid', 'type': 'uint256' }],
    'name': 'initialize',
    'outputs': [],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'lastCrvBalance',
    'outputs': [{ 'internalType': 'uint128', 'name': '', 'type': 'uint128' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'lastCvxBalance',
    'outputs': [{ 'internalType': 'uint128', 'name': '', 'type': 'uint128' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'lastUpdate',
    'outputs': [{ 'internalType': 'uint32', 'name': '', 'type': 'uint32' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'lpToken',
    'outputs': [{ 'internalType': 'contract IERC20', 'name': '', 'type': 'address' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'maxWeeklyEmissionPct',
    'outputs': [{ 'internalType': 'uint16', 'name': '', 'type': 'uint16' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'name',
    'outputs': [{ 'internalType': 'string', 'name': '', 'type': 'string' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [{ 'internalType': 'uint256[]', 'name': 'assignedIds', 'type': 'uint256[]' }],
    'name': 'notifyRegisteredId',
    'outputs': [{ 'internalType': 'bool', 'name': '', 'type': 'bool' }],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'owner',
    'outputs': [{ 'internalType': 'address', 'name': '', 'type': 'address' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'periodFinish',
    'outputs': [{ 'internalType': 'uint32', 'name': '', 'type': 'uint32' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'pushExcessEmissions',
    'outputs': [],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'name': 'rewardIntegral',
    'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [
      { 'internalType': 'address', 'name': '', 'type': 'address' },
      { 'internalType': 'uint256', 'name': '', 'type': 'uint256' }
    ],
    'name': 'rewardIntegralFor',
    'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'name': 'rewardRate',
    'outputs': [{ 'internalType': 'uint128', 'name': '', 'type': 'uint128' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [{ 'internalType': 'uint16', 'name': '_maxWeeklyEmissionPct', 'type': 'uint16' }],
    'name': 'setMaxWeeklyEmissionPct',
    'outputs': [{ 'internalType': 'bool', 'name': '', 'type': 'bool' }],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'storedExcessEmissions',
    'outputs': [{ 'internalType': 'uint128', 'name': '', 'type': 'uint128' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'symbol',
    'outputs': [{ 'internalType': 'string', 'name': '', 'type': 'string' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'totalSupply',
    'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [
      { 'internalType': 'address', 'name': '_to', 'type': 'address' },
      { 'internalType': 'uint256', 'name': '_value', 'type': 'uint256' }
    ],
    'name': 'transfer',
    'outputs': [{ 'internalType': 'bool', 'name': '', 'type': 'bool' }],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      { 'internalType': 'address', 'name': '_from', 'type': 'address' },
      { 'internalType': 'address', 'name': '_to', 'type': 'address' },
      { 'internalType': 'uint256', 'name': '_value', 'type': 'uint256' }
    ],
    'name': 'transferFrom',
    'outputs': [{ 'internalType': 'bool', 'name': '', 'type': 'bool' }],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'vault',
    'outputs': [{ 'internalType': 'contract IPrismaVault', 'name': '', 'type': 'address' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [
      { 'internalType': 'address', 'name': 'claimant', 'type': 'address' },
      { 'internalType': 'address', 'name': 'receiver', 'type': 'address' }
    ],
    'name': 'vaultClaimReward',
    'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      { 'internalType': 'address', 'name': 'receiver', 'type': 'address' },
      { 'internalType': 'uint256', 'name': 'amount', 'type': 'uint256' }
    ],
    'name': 'withdraw',
    'outputs': [{ 'internalType': 'bool', 'name': '', 'type': 'bool' }],
    'stateMutability': 'nonpayable',
    'type': 'function'
  }
]
