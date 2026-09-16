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

/**
 * JSON.stringify that survives blockchain payloads: bigints become decimal strings and raw
 * bytes (CometBFT 0.34 event attributes, keys) become base64, as the node's own JSON does,
 * instead of an object with one key per byte.
 */
const BigintStringify = (obj: unknown): string => {
  return JSON.stringify(obj,
    (key, value) => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      if (value instanceof Uint8Array) {
        return Buffer.from(value).toString("base64");
      }
      return value;
    });
};

export {
  BigintStringify,
  calculateGas,
};
