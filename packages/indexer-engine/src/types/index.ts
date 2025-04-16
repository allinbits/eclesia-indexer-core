import { BlockResponse, BlockResultsResponse } from "@cosmjs/tendermint-rpc";
import { Event } from "@cosmjs/tendermint-rpc/build/comet38/responses";
import { Validator } from "cosmjs-types/cosmos/staking/v1beta1/staking";
import { TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx";

import { EcleciaIndexer } from "../indexer";
import { PromiseQueue } from "../promise-queue";

export type EcleciaIndexerConfig = {
  startHeight?: number;
  endHeight?: number;
  batchSize: number;
  modules: string[];
  getNextHeight: () => number | PromiseLike<number>;
  logLevel: "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly";
  rpcUrl: string;
  genesisPath?: string;
  usePolling?: boolean;
  pollingInterval?: number;
  minimal?: boolean;
  init?: () => Promise<void>;
  beginTransaction: () => Promise<void>;
  endTransaction: (status: boolean) => Promise<void>;
};

export type FullBlockQueue = PromiseQueue<[BlockResponse, BlockResultsResponse, Uint8Array]>;
export type MinimalBlockQueue = PromiseQueue<[BlockResponse, BlockResultsResponse]>;
export type BlockQueue = FullBlockQueue | MinimalBlockQueue;
export type WithHeightAndUUID<T> = {
  [K in keyof T]: T[K] & { uuid?: string;
    height?: number;
    timestamp?: string; };
};
export type EmitFunc<K extends keyof WithHeightAndUUID<EventMap>> = (
  t: K,
  e: WithHeightAndUUID<EventMap>[K]
) => Promise<void | void[]>;


export type LogEvent = {
  type: "log" | "info" | "warning" | "error" | "verbose" | "transient";
  message: string;
};
export type UUIDEvent = {
  uuid: string;
  error?: string;
  status: boolean;
};
export type Events = {
  log: LogEvent;
  uuid: UUIDEvent;
  begin_block: {
    value: {
      events: BlockResultsResponse["beginBlockEvents"];
      validators: Validator[] | undefined;
    };
  };

  block: {
    value: { block: BlockResponse;
      block_results: BlockResultsResponse; };
  };
  end_block: { value: BlockResultsResponse["endBlockEvents"] };
  tx_events: { value: BlockResultsResponse["results"] };
  tx_memo: { value: { txHash: string;
    txBody: TxBody; }; };
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

export interface IndexingModule {
  indexer: EcleciaIndexer;
  name: string;
  depends: string[];
  provides: string[];
  setup: () => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init: (...args: any[]) => void;
}