const abi = [
  {'name':'asset','outputs':[{'type':'address','name':''}],'inputs':[],'stateMutability':'view','type':'function'},
  {'name':'name','outputs':[{'type':'string','name':''}],'inputs':[],'stateMutability':'view','type':'function'},
  {'name':'symbol','outputs':[{'type':'string','name':''}],'inputs':[],'stateMutability':'view','type':'function'},
  {'name':'decimals','outputs':[{'type':'uint256','name':''}],'inputs':[],'stateMutability':'view','type':'function'},

  {'name':'totalAssets','outputs':[{'type':'uint256','name':''}],'inputs':[],'stateMutability':'view','type':'function'},
  {'name':'convertToShares','outputs':[{'type':'uint256','name':'shares'}],'inputs':[{'type':'uint256','name':'assets'}],'stateMutability':'view','type':'function'},
  {'name':'convertToAssets','outputs':[{'type':'uint256','name':'assets'}],'inputs':[{'type':'uint256','name':'shares'}],'stateMutability':'view','type':'function'},
  {'name':'maxDeposit','outputs':[{'type':'uint256','name':''}],'inputs':[{'type':'address','name':'receiver'}],'stateMutability':'view','type':'function'},
  {'name':'previewDeposit','outputs':[{'type':'uint256','name':''}],'inputs':[{'type':'uint256','name':'assets'}],'stateMutability':'view','type':'function'},
  {'name':'maxMint','outputs':[{'type':'uint256','name':''}],'inputs':[{'type':'address','name':'receiver'}],'stateMutability':'view','type':'function'},
  {'name':'previewMint','outputs':[{'type':'uint256','name':''}],'inputs':[{'type':'uint256','name':'shares'}],'stateMutability':'view','type':'function'},
  {'name':'maxWithdraw','outputs':[{'type':'uint256','name':''}],'inputs':[{'type':'address','name':'owner'}],'stateMutability':'view','type':'function'},
  {'name':'previewWithdraw','outputs':[{'type':'uint256','name':''}],'inputs':[{'type':'uint256','name':'assets'}],'stateMutability':'view','type':'function'},
  {'name':'maxRedeem','outputs':[{'type':'uint256','name':''}],'inputs':[{'type':'address','name':'owner'}],'stateMutability':'view','type':'function'},
  {'name':'previewRedeem','outputs':[{'type':'uint256','name':''}],'inputs':[{'type':'uint256','name':'shares'}],'stateMutability':'view','type':'function'},
  {'name':'totalSupply','outputs':[{'type':'uint256','name':''}],'inputs':[],'stateMutability':'view','type':'function'},
  {'name':'balanceOf','outputs':[{'type':'uint256','name':''}],'inputs':[{'type': 'address','name': 'owner'}],'stateMutability':'view','type':'function'},

  {'name':'Deposit','inputs':[
    {'type':'address','name':'sender','indexed':true},
    {'type':'address','name':'owner','indexed':true},
    {'type':'uint256','name':'assets','indexed':false},
    {'type':'uint256','name':'shares','indexed':false}
  ],'anonymous':false,'type':'event'},

  {'name':'Withdraw','inputs':[
    {'type':'address','name':'sender','indexed':true},
    {'type':'address','name':'receiver','indexed':true},
    {'type':'address','name':'owner','indexed':true},
    {'type':'uint256','name':'assets','indexed':false},
    {'type':'uint256','name':'shares','indexed':false}
  ],'anonymous':false,'type':'event'}

] as const
export default abi
