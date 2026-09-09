import { parseAbi } from 'viem'

export default parseAbi([
  'event NewDebtAllocator(address indexed allocator, address indexed governance)',
  'function original() view returns (address)'
])
