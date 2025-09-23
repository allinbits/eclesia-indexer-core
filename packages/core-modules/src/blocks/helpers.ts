import {
  BlockResultsResponse,
} from "@cosmjs/tendermint-rpc";

/**
 * Calculates the total gas used across all transactions in a block
 * @param block - The block results containing transaction execution results
 * @returns Total gas used as a bigint
 */
const calculateGas = (block: BlockResultsResponse): bigint => {
  return block.results.reduce((gas, result) => {
    return result.gasUsed + gas;
  }, 0n);
};

export {
  calculateGas,
};
