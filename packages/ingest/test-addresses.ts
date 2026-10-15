export const addresses = {
  v2: {
    yvusdt: '0x3B27F92C0e212C671EA351827EDF93DB27cc0c65' as `0x${string}`,
    usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as `0x${string}`,
    strategyLenderYieldOptimiser: '0xd8F414beB0aEb5784c5e5eBe32ca9fC182682Ff8' as `0x${string}`,

    yvweth: '0xa258C4606Ca8206D8aA700cE2143D7db854D168c' as `0x${string}`,
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as `0x${string}`,
    genericLevCompFarmWeth: '0x83B6211379c26E0bA8d01b9EcD4eE1aE915630aa' as `0x${string}`,
    strategystEthAccumulator_v2: '0x120FA5738751b275aed7F7b46B98beB38679e093' as `0x${string}`,

    yvwbtc030: '0x0e8A7717A4FD7694682E7005957dD5d7598bF14A' as `0x${string}`,
    yvwbtc030MakerStrategy: '0xA93cb639ae732559AB9315b3A1615e624c32Cc59' as `0x${string}`,

    yvdai043: '0xdA816459F1AB5631232FE5e97a05BBBb94970c95' as `0x${string}`,
    yvdai043LeveragedCompStrategy: '0x1676055fE954EE6fc388F9096210E5EbE0A9070c' as `0x${string}`,
  },

  v3: {
    registry: '0xfF5e3A7C4cBfA9Dd361385c24C3a0A4eE63CE500' as `0x${string}`,
    yvusdca: '0xA013Fbd4b711f9ded6fB09C1c0d358E2FbC2EAA0' as `0x${string}`,
    yvusdca_debtManager: '0x62833b804624452F165272D183193f7D0Df97ab3' as `0x${string}`,
    usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as `0x${string}`,
    aaveV3UsdcLender: '0xdB92B89Ca415c0dab40Dc96E99Fc411C08F20780' as `0x${string}`,
    compoundV3UsdcLender: '0xb1403908F772E4374BB151F7C67E88761a0Eb4f1' as `0x${string}`,
    stargateUsdcStaker: '0x8BBa7AFd0f9B1b664C161EC31d812a8Ec15f7e1a' as `0x${string}`
  },

  // Ethereum yTranche deployment. Tranche A runs the base implementation,
  // B and E the locked one. See docs/ytranche.md.
  tranche: {
    controller: '0xF0145433E5289dd10712650dCd28333FA317eF36' as `0x${string}`,
    hook: '0x776DEd3273440f1481d07B6CE916b5d5Fac170dC' as `0x${string}`,
    mainVault: '0xDa87123895a043Ed3610155550177C54ce8ba49B' as `0x${string}`,
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`,
    a: '0x2D4F47208853a3D20EADCbdA0F03900771C6Eba3' as `0x${string}`,
    b: '0xF7B5D8b432E8c57B4a388c2D833A473091FbF284' as `0x${string}`,
    e: '0xF0A070c0c5b808AbB8EeF6838f178D44A6d9376E' as `0x${string}`
  },

  rando: '0x1B243724A773092Df465B20186aF39Ae0A90fC26' as `0x${string}`
}
