const sdk = require("@defillama/sdk");
const { request, gql } = require("graphql-request");
const { getChainTransform } = require("../helper/portedTokens");
const { BigNumber } = require("ethers");

const graphUrls = {
  ethereum: "https://api.thegraph.com/subgraphs/name/sushi-labs/kashi-ethereum",
  polygon: "https://api.thegraph.com/subgraphs/name/sushi-labs/kashi-polygon",
  arbitrum: "https://api.thegraph.com/subgraphs/name/sushi-labs/kashi-arbitrum",
  bsc: "https://api.thegraph.com/subgraphs/name/sushi-labs/kashi-bsc",
  avax: "https://api.thegraph.com/subgraphs/name/sushiswap/kashi-avalanche",
};

const bentoboxes = {
  ethereum: "0xF5BCE5077908a1b7370B9ae04AdC565EBd643966",
  polygon: "0x0319000133d3AdA02600f0875d2cf03D442C3367",
  arbitrum: "0x74c764D41B77DBbb4fe771daB1939B00b146894A",
  bsc: "0xF5BCE5077908a1b7370B9ae04AdC565EBd643966",
  avax: "0x0711b6026068f736bae6b213031fce978d48e026",
};

const toAmountAbi = {
  inputs: [
    { internalType: "contract IERC20", name: "token", type: "address" },
    { internalType: "uint256", name: "share", type: "uint256" },
    { internalType: "bool", name: "roundUp", type: "bool" },
  ],
  name: "toAmount",
  outputs: [{ internalType: "uint256", name: "amount", type: "uint256" }],
  stateMutability: "view",
  type: "function",
};

const kashiQuery = gql`
  query get_pairs($block: Int) {
    kashiPairs(block: { number: $block }, first: 1000) {
      id
      asset {
        id
      }
      collateral {
        id
      }
      totalAsset {
        elastic
      }
      totalBorrow {
        elastic
      }
      totalCollateralShare
    }
  }
`;

function kashiLending(chain, borrowed) {
  return async (timestamp, ethBlock, chainBlocks) => {
    const balances = {};
    const graphUrl = graphUrls[chain];
    const block = chainBlocks[chain] - 100; //subgraphs can be late by few seconds/minutes
    const transform = await getChainTransform(chain);

    // Query graphql endpoint
    const { kashiPairs } = await request(graphUrl, kashiQuery, {
      block,
    });

    await Promise.all(
      kashiPairs.map(async (pair) => {
        if (
          pair.asset.id === "0x0000000000000000000000000000000000000000" ||
          pair.collateral.id === "0x0000000000000000000000000000000000000000"
        ) {
          return;
        }
        if (borrowed) {
          if (BigNumber.from(pair.totalBorrow.elastic).lte(0)) {
            return;
          }
          //count tokens borrowed
          const shares = pair.totalBorrow.elastic;
          //convert shares to amount
          const amount = (
            await sdk.api.abi.call({
              abi: toAmountAbi,
              chain: chain,
              target: bentoboxes[chain],
              params: [pair.asset.id, shares, false],
              block: block,
            })
          ).output;
          sdk.util.sumSingleBalance(balances, transform(pair.asset.id), amount);
        } else {
          if (
            BigNumber.from(pair.totalAsset.elastic).lte(0) &&
            BigNumber.from(pair.totalAsset.elastic).lte(0)
          ) {
            return;
          }
          //count tokens not borrowed + collateral
          const assetShares = pair.totalAsset.elastic;
          const collateralShares = pair.totalCollateralShare;
          //convert shares to amount
          const assetAmount = (
            await sdk.api.abi.call({
              abi: toAmountAbi,
              chain: chain,
              target: bentoboxes[chain],
              params: [pair.asset.id, assetShares, false],
              block: block,
            })
          ).output;
          const collateralAmount = (
            await sdk.api.abi.call({
              abi: toAmountAbi,
              chain: chain,
              target: bentoboxes[chain],
              params: [pair.collateral.id, collateralShares, false],
              block: block,
            })
          ).output;
          sdk.util.sumSingleBalance(
            balances,
            transform(pair.asset.id),
            assetAmount
          );
          sdk.util.sumSingleBalance(
            balances,
            transform(pair.collateral.id),
            collateralAmount
          );
        }
      })
    );

    return balances;
  };
}

module.exports = {
  kashiLending,
  methodology: `TVL of Sushiswap Kashi lending consists of the tokens available to borrow and the ones used as collateral, tokens borrowed are not counted to avoid inflating TVL through cycled lending.`,
};
