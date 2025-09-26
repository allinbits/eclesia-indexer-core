import {
  BlockResultsResponse,
} from "@cosmjs/tendermint-rpc";
import {
  BlockResultsResponse as BlockResultsResponse38,
} from "@cosmjs/tendermint-rpc/build/comet38/responses.js";
/**
 * Calculates the total gas used across all transactions in a block
 * @param block - The block results containing transaction execution results
 * @returns Total gas used as a bigint
 */
const calculateGas = (block: BlockResultsResponse | BlockResultsResponse38): bigint => {
  return block.results.reduce((gas, result) => {
    return result.gasUsed + gas;
  }, 0n);
};

export {
  calculateGas,
};
