const abi = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'token',
        type: 'address'
      },
      {
        indexed: false,
        internalType: 'address',
        name: 'stakingPool',
        type: 'address'
      }
    ],
    name: 'StakingPoolAdded',
    type: 'event'
  }
] as const
export default abi
