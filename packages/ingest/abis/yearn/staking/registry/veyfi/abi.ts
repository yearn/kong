const abi = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'gauge',
        type: 'address'
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'idx',
        type: 'uint256'
      }
    ],
    name: 'Register',
    type: 'event'
  }
] as const
export default abi
