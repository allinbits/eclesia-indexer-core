/* eslint-disable @stylistic/no-multi-spaces */
import {
  BlockResponse, BlockResultsResponse,
} from "@cosmjs/tendermint-rpc";
import {
  Event,
} from "@cosmjs/tendermint-rpc/build/comet38/responses";
import {
  Validator,
} from "cosmjs-types/cosmos/staking/v1beta1/staking";
import {
  TxBody,
} from "cosmjs-types/cosmos/tx/v1beta1/tx";

import {
  EcleciaIndexer,
} from "../indexer";
import {
  CircularBuffer,
} from "../promise-queue";

/** Configuration interface for the Eclesia indexer */
export type EcleciaIndexerConfig = {
  startHeight?: number                                           // Block height to start indexing from
  endHeight?: number                                             // Block height to stop indexing at (optional)
  batchSize: number                                              // Number of blocks to process in parallel
  modules: string[]                                              // List of module names to enable
  getNextHeight: () => number | PromiseLike<number>             // Function to determine next block to process
  logLevel: "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly" // Logging verbosity level
  rpcUrl: string                                                 // Tendermint RPC endpoint URL
  shouldProcessGenesis: () => Promise<boolean>                   // Whether to process genesis state
  genesisPath?: string                                           // Path to genesis file
  usePolling?: boolean                                           // Use polling instead of WebSocket subscription
  pollingInterval?: number                                       // Interval between polls in milliseconds
  minimal?: boolean                                              // Use minimal indexing mode (blocks only)
  init?: () => Promise<void>                                     // Custom initialization function
  beginTransaction: () => Promise<void>                          // Function to begin database transaction
  endTransaction: (status: boolean) => Promise<void>            // Function to end database transaction
};

/** Queue for full indexing mode with validator data */
export type FullBlockQueue = CircularBuffer<[BlockResponse, BlockResultsResponse, Uint8Array]>;

/** Queue for minimal indexing mode without validator data */
export type MinimalBlockQueue = CircularBuffer<[BlockResponse, BlockResultsResponse]>;

/** Union type for block queues */
export type BlockQueue = FullBlockQueue | MinimalBlockQueue;

/** Utility type to add height, timestamp, and UUID to event types */
export type WithHeightAndUUID<T> = {
  [K in keyof T]: T[K] & {
    uuid?: string      // Unique identifier for event tracking
    height?: number    // Block height when event occurred
    timestamp?: string // Block timestamp when event occurred
  };
};

/** Function signature for emitting events asynchronously */
export type EmitFunc<K extends keyof WithHeightAndUUID<EventMap>> = (
  t: K,
  e: WithHeightAndUUID<EventMap>[K]
) => Promise<void | void[]>;

export type LogEvent = {
  type: "log" | "info" | "warning" | "error" | "verbose" | "transient"
  message: string
};
export type UUIDEvent = {
  uuid: string
  error?: string
  status: boolean
};
export type Events = {
  log: LogEvent
  uuid: UUIDEvent
  begin_block: {
    value: {
      events: BlockResultsResponse["beginBlockEvents"]
      validators: Validator[] | undefined
    }
  }

  block: {
    value: {
      block: BlockResponse
      block_results: BlockResultsResponse
    }
  }
  end_block: {
    value: BlockResultsResponse["endBlockEvents"]
  }
  tx_events: {
    value: BlockResultsResponse["results"]
  }
  tx_memo: {
    value: {
      txHash: string
      txBody: TxBody
    }
  }
  _unhandled: {
    type: string
    event: unknown
  }
  "periodic/50": {
    value: null
  }
  "periodic/100": {
    value: null
  }
  "periodic/1000": {
    value: null
  }
};
export type TxResult<T> = {
  tx: T
  events: Event[]
};

/** Interface that all indexing modules must implement */
export interface IndexingModule {
  indexer: EcleciaIndexer                    // Reference to the main indexer instance
  name: string                               // Unique module name
  depends: string[]                          // Array of module names this module depends on
  provides: string[]                         // Array of capabilities this module provides
  setup: () => Promise<void>                 // Async setup function for database schema initialization
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init: (...args: any[]) => void            // Initialization function called by the indexer
}
