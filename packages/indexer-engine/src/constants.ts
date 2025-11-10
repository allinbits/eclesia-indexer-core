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
 * Timeout for RPC calls in milliseconds
 * If a call takes longer than this, it will be rejected
 */
export const RPC_TIMEOUT_MS = 20000;

/**
 * Timeout for block queue dequeue operations in milliseconds
 * If no block is available within this time, an error will be thrown
 */
export const QUEUE_DEQUEUE_TIMEOUT_MS = 30000;

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
