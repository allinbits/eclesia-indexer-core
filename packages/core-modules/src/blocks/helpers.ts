import {
  BlockResultsResponse,
} from "@cosmjs/tendermint-rpc";

const calculateGas = (block: BlockResultsResponse): bigint => {
  return block.results.reduce((gas, result) => {
    return result.gasUsed + gas;
  }, 0n);
};

export {
  calculateGas,
};
