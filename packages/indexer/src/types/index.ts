import { Event } from "@cosmjs/tendermint-rpc/build/comet38/responses";
import {
  BlockResponse,
  BlockResultsResponse
} from "@cosmjs/tendermint-rpc/build/tendermint34/responses";
import { Validator } from "cosmjs-types/cosmos/staking/v1beta1/staking";

export type LogEvent = {
  type: "log" | "info" | "warning" | "error" | "verbose" | "transient";
  message: string;
};
export type UUIDEvent = {
  uuid: string;
  status: boolean;
};
export type Events = {
  log: LogEvent;
  uuid: UUIDEvent;
  begin_block: {
    value: {
      events: BlockResultsResponse["beginBlockEvents"];
      validators: Validator[];
    };
  };

  block: {
    value: { block: BlockResponse;
      block_results: BlockResultsResponse; };
  };
  end_block: { value: BlockResultsResponse["endBlockEvents"] };
  tx_events: { value: BlockResultsResponse["results"] };
  _unhandled: { type: string;
    event: unknown; };
  "periodic/50": { value: null };
  "periodic/100": { value: null };
  "periodic/1000": { value: null };
};
export type TxResult<T> = {
  tx: T;
  events: Event[];
};
