/* eslint-disable @stylistic/no-multi-spaces */
import type {
  BlockOf, ChainAdapter, FetchedBlock,
} from "../chain/index.js";
import type {
  EclesiaIndexer,
} from "../indexer/index.js";
import type {
  CircularBuffer,
} from "../promise-queue/index.js";

export type LogLevel = "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly";

/**
 * Configuration interface for the Eclesia indexer. `A` is the chain adapter the indexer runs on;
 * it decides what an RPC client and a block are, and which events a block turns into.
 */
export type EclesiaIndexerConfig<A extends ChainAdapter = ChainAdapter> = {
  chain: A                                                       // Chain adapter (e.g. cosmos() from @eclesia/chain-cosmos)
  startHeight?: number                                           // Block height to start indexing from
  endHeight?: number                                             // Block height to stop indexing at (optional)
  batchSize: number                                              // Number of blocks to process in parallel
  modules: string[]                                              // List of module names to enable
  getNextHeight: () => number | PromiseLike<number>             // Function to determine next block to process
  logLevel: LogLevel                                             // Logging verbosity level
  rpcUrl: string                                                 // RPC endpoint URL
  chainId?: string                                               // Refuse to index if the RPC reports a different network
  shouldProcessGenesis: () => Promise<boolean>                   // Whether to process genesis state
  genesisPath?: string                                           // Path to genesis file
  usePolling?: boolean                                           // Use polling instead of a block subscription
  pollingInterval?: number                                       // Interval between polls in milliseconds
  minimal?: boolean                                              // Use minimal indexing mode (lets the adapter skip expensive per-block data)
  enableHealthcheck?: boolean                                    // Enable health check HTTP server
  healthCheckPort?: number                                       // Port for health check HTTP server (default: 8888)
  enablePrometheus?: boolean                                     // Enable Prometheus metrics server
  prometheusPort?: number                                        // Port for Prometheus metrics server (default: 9090)
  healthCheckHost?: string                                       // Address the health check server binds to (default: 0.0.0.0)
  prometheusHost?: string                                        // Address the metrics server binds to (default: 0.0.0.0)
  logFormat?: "text" | "json"                                    // Console log format (default: text)
  maxRetries?: number                                            // Emit fatal-error after this many consecutive failed restarts; unlimited when unset
  maxFailuresPerBlock?: number                                   // Consecutive processing failures on one block before fatal-error (default: 5)
  onGenesisStart?: () => Promise<void>                           // Called before the genesis import begins, outside any transaction
  onGenesisComplete?: () => Promise<void>                        // Called inside the final genesis transaction, right before it commits
  init?: () => Promise<void>                                     // Custom initialization function
  beginTransaction: () => Promise<void>                          // Function to begin database transaction
  endTransaction: (status: boolean) => Promise<void>             // Function to end database transaction
};

/** Queue of fetched blocks awaiting processing */
export type BlockQueue<A extends ChainAdapter = ChainAdapter> = CircularBuffer<FetchedBlock<BlockOf<A>> | undefined>;

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
  e: WithHeightAndUUID<EventMap>[K],
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

/**
 * Events the engine itself emits, for every chain. Chain adapters add the block-level events
 * (blocks, transactions, messages) and modules add their own, all through EventMap merging.
 */
export type Events = {
  log: LogEvent
  uuid: UUIDEvent
  "fatal-error": {
    error: Error
    message: string
    retryCount?: number
    height?: number   // Set when one block failed repeatedly
  }
  _unhandled: {
    type: string
    event: unknown
  }
  "periodic/small": {
    value: null
  }
  "periodic/medium": {
    value: null
  }
  "periodic/large": {
    value: null
  }
};

/** Interface that all indexing modules must implement */
export interface IndexingModule<A extends ChainAdapter = ChainAdapter> {
  indexer: EclesiaIndexer<A>                 // Reference to the main indexer instance
  name: string                               // Unique module name
  depends: string[]                          // Array of module names this module depends on
  provides: string[]                         // Array of capabilities this module provides
  setup: () => Promise<void>                 // Async setup function for database schema initialization
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init: (...args: any[]) => void            // Initialization function called by the indexer
}

/**
 * Global event map. Chain adapters and modules add their own events through declaration merging:
 *
 *   declare global { interface EventMap extends MyModule.Events {} }
 *
 * Declared in a regular module (not an ambient .d.ts) so it is emitted into the
 * published declarations and consumers get typed events without extra setup.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface EventMap extends Events {
  }
}
