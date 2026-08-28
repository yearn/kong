// Read interface for the yTranche Hook contract.
//
// The Hook is not an indexed abiPath: it owns no thing and no snapshot of its
// own (see docs/ytranche.md). Its state is read through this interface by the
// tranche snapshot hook and appended to each tranche snapshot as `hookState`.
// Only the reads that enrichment needs are declared here — writes, roles and
// the per-account `allowed` mapping are deliberately absent.
const abi = [
  {'name':'open','outputs':[{'type':'bool','name':''}],'inputs':[],'stateMutability':'view','type':'function'},
  {'name':'rateLimitWindow','outputs':[{'type':'uint256','name':''}],'inputs':[],'stateMutability':'view','type':'function'},

  {'name':'depositLimits','outputs':[{'type':'uint256','name':''}],'inputs':[{'type':'address','name':''}],'stateMutability':'view','type':'function'},

  {'name':'depositRateLimit','outputs':[
    {'type':'uint128','name':'used'},
    {'type':'uint64','name':'windowStart'},
    {'type':'uint128','name':'rateLimit'}
  ],'inputs':[{'type':'address','name':''}],'stateMutability':'view','type':'function'},

  {'name':'withdrawRateLimit','outputs':[
    {'type':'uint128','name':'used'},
    {'type':'uint64','name':'windowStart'},
    {'type':'uint128','name':'rateLimit'}
  ],'inputs':[{'type':'address','name':''}],'stateMutability':'view','type':'function'},

  {'name':'depositCap','outputs':[{'type':'uint256','name':''}],'inputs':[{'type':'address','name':'_tranche'}],'stateMutability':'view','type':'function'},
  {'name':'withdrawCap','outputs':[{'type':'uint256','name':''}],'inputs':[{'type':'address','name':'_tranche'}],'stateMutability':'view','type':'function'}
] as const
export default abi
