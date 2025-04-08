export const cvxBoosterAbi = [
  {
    'inputs': [
      {'internalType': 'address', 'name': '_staker', 'type': 'address'},
      {'internalType': 'address', 'name': '_minter', 'type': 'address'}
    ],
    'stateMutability': 'nonpayable',
    'type': 'constructor'
  },
  {
    'anonymous': false,
    'inputs': [
      {'indexed': true, 'internalType': 'address', 'name': 'user', 'type': 'address'},
      {'indexed': true, 'internalType': 'uint256', 'name': 'poolid', 'type': 'uint256'},
      {'indexed': false, 'internalType': 'uint256', 'name': 'amount', 'type': 'uint256'}
    ],
    'name': 'Deposited',
    'type': 'event'
  },
  {
    'anonymous': false,
    'inputs': [
      {'indexed': true, 'internalType': 'address', 'name': 'user', 'type': 'address'},
      {'indexed': true, 'internalType': 'uint256', 'name': 'poolid', 'type': 'uint256'},
      {'indexed': false, 'internalType': 'uint256', 'name': 'amount', 'type': 'uint256'}
    ],
    'name': 'Withdrawn',
    'type': 'event'
  },
  {
    'inputs': [],
    'name': 'FEE_DENOMINATOR',
    'outputs': [{'internalType': 'uint256', 'name': '', 'type': 'uint256'}],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'MaxFees',
    'outputs': [{'internalType': 'uint256', 'name': '', 'type': 'uint256'}],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [
      {'internalType': 'address', 'name': '_lptoken', 'type': 'address'},
      {'internalType': 'address', 'name': '_gauge', 'type': 'address'},
      {'internalType': 'uint256', 'name': '_stashVersion', 'type': 'uint256'}
    ],
    'name': 'addPool',
    'outputs': [{'internalType': 'bool', 'name': '', 'type': 'bool'}],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      {'internalType': 'uint256', 'name': '_pid', 'type': 'uint256'},
      {'internalType': 'address', 'name': '_gauge', 'type': 'address'}
    ],
    'name': 'claimRewards',
    'outputs': [{'internalType': 'bool', 'name': '', 'type': 'bool'}],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'crv',
    'outputs': [{'internalType': 'address', 'name': '', 'type': 'address'}],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [
      {'internalType': 'uint256', 'name': '_pid', 'type': 'uint256'},
      {'internalType': 'uint256', 'name': '_amount', 'type': 'uint256'},
      {'internalType': 'bool', 'name': '_stake', 'type': 'bool'}
    ],
    'name': 'deposit',
    'outputs': [{'internalType': 'bool', 'name': '', 'type': 'bool'}],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      {'internalType': 'uint256', 'name': '_pid', 'type': 'uint256'},
      {'internalType': 'bool', 'name': '_stake', 'type': 'bool'}
    ],
    'name': 'depositAll',
    'outputs': [{'internalType': 'bool', 'name': '', 'type': 'bool'}],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'distributionAddressId',
    'outputs': [{'internalType': 'uint256', 'name': '', 'type': 'uint256'}],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'earmarkFees',
    'outputs': [{'internalType': 'bool', 'name': '', 'type': 'bool'}],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'earmarkIncentive',
    'outputs': [{'internalType': 'uint256', 'name': '', '极型': 'uint256'}],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [
      {'internalType': 'uint256', 'name': '_pid', 'type': 'uint256'}
    ],
    'name': 'earmarkRewards',
    'outputs': [{'internalType': 'bool', 'name': '', 'type': 'bool'}],
    'stateMutability': 'nonpayable',
    'type': '极型'
  }
]
