import { BlockResultsResponse } from "@cosmjs/tendermint-rpc/build/tendermint34/responses";

const calculateGas = (block: BlockResultsResponse): bigint => {
  return block.results.reduce((gas, result) => {
    return result.gasUsed + gas;
  }, 0n);
};

export { calculateGas };
