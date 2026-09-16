/* eslint-disable @stylistic/no-multi-spaces */
import type {
  BlockResponse, BlockResultsResponse,
} from "@cosmjs/tendermint-rpc";
import type {
  BlockResultsResponse as BlockResultsResponse38, Event,
} from "@cosmjs/tendermint-rpc/build/comet38/responses";
import type {
  Validator,
} from "cosmjs-types/cosmos/staking/v1beta1/staking";
import type {
  TxBody,
} from "cosmjs-types/cosmos/tx/v1beta1/tx";

/** What the Cosmos adapter fetches for one height */
export type CosmosBlock = {
  block: BlockResponse                                          // Block with its raw transactions
  blockResults: BlockResultsResponse | BlockResultsResponse38   // Execution results (CometBFT 0.37 or 0.38 shape)
  validators?: Validator[]                                      // Complete validator set at this height (full mode only)
};

/** A decoded message together with the events attributed to it */
export type TxResult<T> = {
  tx: T
  events: Event[]
};

/**
 * Events the Cosmos adapter emits for every block, in this order: `block`, `begin_block`,
 * `tx_events`, then per successful transaction `tx_memo` (when there is one) and one event per
 * message named after its type URL, then `end_block`. Message events are added to the EventMap
 * by the modules that handle them.
 */
export type Events = {
  begin_block: {
    value: {
      events: BlockResultsResponse["beginBlockEvents"] | BlockResultsResponse38["finalizeBlockEvents"]
      validators: Validator[] | undefined
    }
  }
  block: {
    value: {
      block: BlockResponse
      block_results: BlockResultsResponse | BlockResultsResponse38
    }
  }
  end_block: {
    value: BlockResultsResponse["endBlockEvents"] | BlockResultsResponse38["finalizeBlockEvents"]
  }
  tx_events: {
    value: BlockResultsResponse["results"] | BlockResultsResponse38["results"]
  }
  tx_memo: {
    value: {
      txHash: string
      txBody: TxBody
    }
  }
};
