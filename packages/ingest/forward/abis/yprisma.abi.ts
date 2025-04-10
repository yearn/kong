export const yprismaAbi = [
  {
    'inputs': [
      {'internalType': 'address', 'name': '_vault', 'type': 'address'},
      {'internalType': 'address', 'name': '_tradeFactory', 'type': 'address'},
      {'internalType': 'uint256', 'name': '_harvestProfitMinInUsdc', 'type': 'uint256'},
      {'internalType': 'uint256', 'name': '_harvestProfitMaxInUsdc', 'type': 'uint256'},
      {'internalType': 'address', 'name': '_prismaVault', 'type': 'address'},
      {'internalType': 'address', 'name': '_prismaReceiver', 'type': 'address'}
    ],
    'stateMutability': 'nonpayable',
    'type': 'constructor'
  },
  {'anonymous':false,'inputs':[{'indexed':true,'internalType':'address','name':'clone','type':'address'}],'name':'Cloned','type':'event'},
  {'anonymous':false,'inputs':[],'name':'EmergencyExitEnabled','type':'event'},
  {'anonymous':false,'inputs':[{'indexed':false,'internalType':'bool','name':'triggerState','type':'bool'}],'name':'ForcedHarvestTrigger','type':'event'},
  {'anonymous':false,'inputs':[{'indexed':false,'internalType':'uint256','name':'profit','type':'uint256'},{'indexed':false,'internalType':'uint256','name':'loss','type':'uint256'},{'indexed':false,'internalType':'uint256','name':'debtPayment','type':'uint256'},{'indexed':false,'internalType':'uint256','name':'debtOutstanding','type':'uint256'}],'name':'Harvested','type':'event'},
  {'anonymous':false,'inputs':[{'indexed':false,'internalType':'bool','name':'','type':'bool'}],'name':'SetDoHealthCheck','type':'event'},
  {'anonymous':false,'inputs':[{'indexed':false,'internalType':'address','name':'','type':'address'}],'name':'SetHealthCheck','type':'event'},
  {'anonymous':false,'inputs':[{'indexed':false,'internalType':'address','name':'baseFeeOracle','type':'address'}],'name':'UpdatedBaseFeeOracle','type':'event'},
  {'anonymous':false,'inputs':[{'indexed':false,'internalType':'uint256','name':'creditThreshold','type':'uint256'}],'name':'UpdatedCreditThreshold','type':'event'},
  {'anonymous':false,'inputs':[{'indexed':false,'internalType':'address','name':'newKeeper','type':'address'}],'name':'UpdatedKeeper','type':'event'},
  {'anonymous':false,'inputs':[{'indexed':false,'internalType':'uint256','name':'delay','type':'uint256'}],'name':'UpdatedMaxReportDelay','type':'event'},
  {'anonymous':false,'inputs':[{'indexed':false,'internalType':'string','name':'metadataURI','type':'string'}],'name':'UpdatedMetadataURI','type':'event'},
  {'anonymous':false,'inputs':[{'indexed':false,'internalType':'uint256','name':'delay','type':'uint256'}],'name':'UpdatedMinReportDelay','type':'event'},
  {'anonymous':false,'inputs':[{'indexed':false,'internalType':'address','name':'rewards','type':'address'}],'name':'UpdatedRewards','type':'event'},
  {'anonymous':false,'inputs':[{'indexed':false,'internalType':'address','name':'newStrategist','type':'address'}],'name':'UpdatedStrategist','type':'event'},
  {'inputs':[],'name':'apiVersion','outputs':[{'internalType':'string','name':'','type':'string'}],'stateMutability':'pure','type':'function'},
  {'inputs':[],'name':'balanceOfWant','outputs':[{'internalType':'uint256','name':'','type':'uint256'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'baseFeeOracle','outputs':[{'internalType':'address','name':'','type':'address'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'claimRewards','outputs':[],'stateMutability':'nonpayable','type':'function'},
  {'inputs':[],'name':'claimableProfitInUsdc','outputs':[{'internalType':'uint256','name':'','type':'uint256'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'claimsAreMaxBoosted','outputs':[{'internalType':'bool','name':'','type':'bool'}],'stateMutability':'view','type':'function'},
  {'inputs': [{'internalType': 'address', 'name': '_vault', 'type': 'address'}, {'internalType': 'address', 'name': '_strategist', 'type': 'address'}, {'internalType': 'address', 'name': '_rewards', 'type': 'address'}, {'internalType': 'address', 'name': '_keeper', 'type': 'address'}, {'internalType': 'address', 'name': '_tradeFactory', 'type': 'address'}, {'internalType': 'uint256', 'name': '_harvestProfitMinInUsdc', 'type': 'uint256'}, {'internalType': 'uint256', 'name': '_harvestProfitMaxInUsdc', 'type': 'uint256'}, {'internalType': 'address', 'name': '_prismaVault', 'type': 'address'}, {'internalType': 'address', 'name': '_prismaReceiver', 'type': 'address'}], 'name': 'cloneStrategyPrismaConvex', 'outputs': [{'internalType': 'address', 'name': 'newStrategy', 'type': 'address'}], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs':[],'name':'convexToken','outputs':[{'internalType':'contractIERC20','name':'','type':'address'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'convexVoter','outputs':[{'internalType':'address','name':'','type':'address'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'creditThreshold','outputs':[{'internalType':'uint256','name':'','type':'uint256'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'crv','outputs':[{'internalType':'contractIERC20','name':'','type':'address'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'curveVoter','outputs':[{'internalType':'address','name':'','type':'address'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'delegatedAssets','outputs':[{'internalType':'uint256','name':'','type':'uint256'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'doHealthCheck','outputs':[{'internalType':'bool','name':'','type':'bool'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'emergencyExit','outputs':[{'internalType':'bool','name':'','type':'bool'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'estimatedTotalAssets','outputs':[{'internalType':'uint256','name':'','type':'uint256'}],'stateMutability':'view','type':'function'},
  {'inputs': [{'internalType': 'uint256', 'name': '_ethAmount', 'type': 'uint256'}], 'name': 'ethToWant', 'outputs': [{'internalType': 'uint256', 'name': '', 'type': 'uint256'}], 'stateMutability': 'view', 'type': 'function'},
  {'inputs':[],'name':'forceClaimOnce','outputs':[{'internalType':'bool','name':'','type':'bool'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'forceHarvestTriggerOnce','outputs':[{'internalType':'bool','name':'','type':'bool'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'harvest','outputs':[],'stateMutability':'nonpayable','type':'function'},
  {'inputs':[],'name':'harvestProfitMaxInUsdc','outputs':[{'internalType':'uint256','name':'','type':'uint256'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'harvestProfitMinInUsdc','outputs':[{'internalType':'uint256','name':'','type':'uint256'}],'stateMutability':'view','type':'function'},
  {'inputs': [{'internalType': 'uint256', 'name': '_callCostinEth', 'type': 'uint256'}], 'name': 'harvestTrigger', 'outputs': [{'internalType': 'bool', 'name': '', 'type': 'bool'}], 'stateMutability': 'view', 'type': 'function'},
  {'inputs':[],'name':'healthCheck','outputs':[{'internalType':'address','name':'','type':'address'}],'stateMutability':'view','type':'function'},
  {'inputs': [{'internalType': 'address', 'name': '_vault', 'type': 'address'}, {'internalType': 'address', 'name': '_strategist', 'type': 'address'}, {'internalType': 'address', 'name': '_rewards', 'type': 'address'}, {'internalType': 'address', 'name': '_keeper', 'type': 'address'}, {'internalType': 'address', 'name': '_tradeFactory', 'type': 'address'}, {'internalType': 'uint256', 'name': '_harvestProfitMinInUsdc', 'type': 'uint256'}, {'internalType': 'uint256', 'name': '_harvestProfitMaxInUsdc', 'type': 'uint256'}, {'internalType': 'address', 'name': '_prismaVault', 'type': 'address'}, {'internalType': 'address', 'name': '_prismaReceiver', 'type': 'address'}], 'name': 'initialize', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs':[],'name':'isActive','outputs':[{'internalType':'bool','name':'','type':'bool'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'isBaseFeeAcceptable','outputs':[{'internalType':'bool','name':'','type':'bool'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'isOriginal','outputs':[{'internalType':'bool','name':'','type':'bool'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'keeper','outputs':[{'internalType':'address','name':'','type':'address'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'localKeepCRV','outputs':[{'internalType':'uint256','name':'','type':'uint256'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'localKeepCVX','outputs':[{'internalType':'uint256','name':'','type':'uint256'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'localKeepYPrisma','outputs':[{'internalType':'uint256','name':'','type':'uint256'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'maxReportDelay','outputs':[{'internalType':'uint256','name':'','type':'uint256'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'metadataURI','outputs':[{'internalType':'string','name':'','type':'string'}],'stateMutability':'view','type':'function'},
  {'inputs': [{'internalType': 'address', 'name': '_newStrategy', 'type': 'address'}], 'name': 'migrate', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs':[],'name':'minReportDelay','outputs':[{'internalType':'uint256','name':'','type':'uint256'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'name','outputs':[{'internalType':'string','name':'','type':'string'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'prismaReceiver','outputs':[{'internalType':'contractIPrismaReceiver','name':'','type':'address'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'prismaVault','outputs':[{'internalType':'contractIPrismaVault','name':'','type':'address'}],'stateMutability':'view','type':'function'},
  {'inputs': [{'internalType': 'bool', 'name': '_disableTf', 'type': 'bool'}], 'name': 'removeTradeFactoryPermissions', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs':[],'name':'rewards','outputs':[{'internalType':'address','name':'','type':'address'}],'stateMutability':'view','type':'function'},
  {'inputs': [{'internalType': 'address', 'name': '_baseFeeOracle', 'type': 'address'}], 'name': 'setBaseFeeOracle', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs': [{'internalType': 'uint256', 'name': '_creditThreshold', 'type': 'uint256'}], 'name': 'setCreditThreshold', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs': [{'internalType': 'bool', 'name': '_doHealthCheck', 'type': 'bool'}], 'name': 'setDoHealthCheck', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs':[],'name':'setEmergencyExit','outputs':[],'stateMutability':'nonpayable','type':'function'},
  {'inputs': [{'internalType': 'bool', 'name': '_forceClaimOnce', 'type': 'bool'}], 'name': 'setForceClaimOnce', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs': [{'internalType': 'bool', 'name': '_forceHarvestTriggerOnce', 'type': 'bool'}], 'name': 'setForceHarvestTriggerOnce', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs': [{'internalType': 'uint256', 'name': '_harvestProfitMinInUsdc', 'type': 'uint256'}, {'internalType': 'uint256', 'name': '_harvestProfitMaxInUsdc', 'type': 'uint256'}], 'name': 'setHarvestTriggerParams', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs': [{'internalType': 'address', 'name': '_healthCheck', 'type': 'address'}], 'name': 'setHealthCheck', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs': [{'internalType': 'address', 'name': '_keeper', 'type': 'address'}], 'name': 'setKeeper', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs': [{'internalType': 'uint256', 'name': '_keepCrv', 'type': 'uint256'}, {'internalType': 'uint256', 'name': '_keepCvx', 'type': 'uint256'}, {'internalType': 'uint256', 'name': '_keepYPrisma', 'type': 'uint256'}], 'name': 'setLocalKeepCrvs', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs': [{'internalType': 'uint256', 'name': '_delay', 'type': 'uint256'}], 'name': 'setMaxReportDelay', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs': [{'internalType': 'string', 'name': '_metadataURI', 'type': 'string'}], 'name': 'setMetadataURI', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs': [{'internalType': 'uint256', 'name': '_delay', 'type': 'uint256'}], 'name': 'setMinReportDelay', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs': [{'internalType': 'address', 'name': '_rewards', 'type': 'address'}], 'name': 'setRewards', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs': [{'internalType': 'address', 'name': '_strategist', 'type': 'address'}], 'name': 'setStrategist', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs': [{'internalType': 'address', 'name': '_curveVoter', 'type': 'address'}, {'internalType': 'address', 'name': '_convexVoter', 'type': 'address'}, {'internalType': 'address', 'name': '_yprismaVoter', 'type': 'address'}], 'name': 'setVoters', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs':[],'name':'stakedBalance','outputs':[{'internalType':'uint256','name':'','type':'uint256'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'strategist','outputs':[{'internalType':'address','name':'','type':'address'}],'stateMutability':'view','type':'function'},
  {'inputs': [{'internalType': 'address', 'name': '_token', 'type': 'address'}], 'name': 'sweep', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs':[],'name':'tend','outputs':[],'stateMutability':'nonpayable','type':'function'},
  {'inputs': [{'internalType': 'uint256', 'name': '_callCostInWei', 'type': 'uint256'}], 'name': 'tendTrigger', 'outputs': [{'internalType': 'bool', 'name': '', 'type': 'bool'}], 'stateMutability': 'view', 'type': 'function'},
  {'inputs':[],'name':'tradeFactory','outputs':[{'internalType':'address','name':'','type':'address'}],'stateMutability':'view','type':'function'},
  {'inputs': [{'internalType': 'address', 'name': '_newTradeFactory', 'type': 'address'}], 'name': 'updateTradeFactory', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs':[],'name':'vault','outputs':[{'internalType':'contractVaultAPI','name':'','type':'address'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'want','outputs':[{'internalType':'contractIERC20','name':'','type':'address'}],'stateMutability':'view','type':'function'},
  {'inputs': [{'internalType': 'uint256', 'name': '_amountNeeded', 'type': 'uint256'}], 'name': 'withdraw', 'outputs': [{'internalType': 'uint256', 'name': '_loss', 'type': 'uint256'}], 'stateMutability': 'nonpayable', 'type': 'function'},
  {'inputs':[],'name':'yPrisma','outputs':[{'internalType':'contractIERC20','name':'','type':'address'}],'stateMutability':'view','type':'function'},
  {'inputs':[],'name':'yprismaVoter','outputs':[{'internalType':'address','name':'','type':'address'}],'stateMutability':'view','type':'function'}
] as const


