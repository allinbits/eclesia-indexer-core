/**
 * Configuration constants for the Eclesia indexer
 * These values control performance, timeouts, and connection management
 */

/**
 * Number of blocks to prefetch and keep in the processing queue
 * Higher values increase memory usage but improve throughput
 * Recommended range: 300-1000 depending on block size and available memory
 */
export const DEFAULT_BATCH_SIZE = 500;

/**
 * Default start height for indexing when no previous height is found
 */
export const DEFAULT_START_HEIGHT = 1;

/**
 * Default port for health check HTTP server
 */
export const DEFAULT_HEALTH_CHECK_PORT = 8888;

/**
 * Default port for Prometheus metrics server
 */
export const DEFAULT_PROMETHEUS_PORT = 9090;

/**
 * Default polling interval in milliseconds when using polling mode instead of WebSocket
 */
export const DEFAULT_POLLING_INTERVAL_MS = 5000;

/**
 * Timeout for connecting to the Tendermint RPC in milliseconds
 * If connection is not established within this time, it will be aborted
  */
export const CONNECT_TIMEOUT_MS = 10000;

/**
 * Timeout for RPC calls in milliseconds
 * If a call takes longer than this, it will be rejected
 */
export const RPC_TIMEOUT_MS = 20000;

/**
 * @deprecated Waiting for a block is no longer bounded by a timeout: an idle chain is not an
 * error. Kept as an export for compatibility; see IDLE_CHECK_INTERVAL_MS.
 */
export const QUEUE_DEQUEUE_TIMEOUT_MS = 30000;

/**
 * How long the indexer waits without any block announcement before checking the chain height.
 * If the chain has moved on without us the subscription is dead and a recovery is triggered;
 * if the chain is simply idle (halt, upgrade) the indexer reports WAITING and checks again.
 */
export const IDLE_CHECK_INTERVAL_MS = 30000;

/**
 * Delay before the first restart after a failure; doubles on every consecutive failure
 */
export const RETRY_BASE_DELAY_MS = 5000;

/**
 * Upper bound for the restart delay
 */
export const RETRY_MAX_DELAY_MS = 300000;

/**
 * Consecutive processing failures on the same block before the indexer gives up with a
 * fatal-error. A block that keeps failing after its data was fetched is a bug or bad data, not
 * an outage, and retrying it forever hides the problem.
 */
export const MAX_FAILURES_PER_BLOCK = 5;

/**
 * Address the health check and metrics servers bind to unless configured otherwise
 */
export const DEFAULT_BIND_HOST = "0.0.0.0";

/**
 * Number of successful transactions before recycling the database client
 * Prevents long-running connection issues and stale connections
 */
export const DB_CLIENT_RECYCLE_COUNT = 1500;

/**
 * Block intervals for periodic event emission
 * Used for operations that should run at regular block intervals
 */
export const PERIODIC_INTERVALS = {
  /** Emit periodic event every 50 blocks */
  SMALL: 50,
  /** Emit periodic event every 100 blocks */
  MEDIUM: 100,
  /** Emit periodic event every 1000 blocks - used for performance logging */
  LARGE: 1000,
} as const;

/**
 * Pagination limits for blockchain queries
 */
export const PAGINATION_LIMITS = {
  /** Default limit for validator queries */
  VALIDATORS: 1000n,
  /** Default limit for delegation queries */
  DELEGATIONS: 250n,
} as const;

/**
 * Batch size for streaming genesis file processing
 * Number of entries to process at once from genesis JSON
 */
export const GENESIS_BATCH_SIZE = 1000;
