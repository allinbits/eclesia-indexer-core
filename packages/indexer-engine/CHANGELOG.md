# @eclesia/indexer-engine

## 2.12.0

### Minor Changes

- Fix metrics and increase save TX performance

## 2.11.1

### Patch Changes

- Fix type export

## 2.11.0

### Minor Changes

- Benchmark improvements and RPC bug

## 2.10.0

### Minor Changes

- e510e50: Add Prometheus metrics export for production monitoring. Created IndexerMetrics class with metrics for blocks indexed, queue depth, error rates, and processing durations. Includes default Node.js metrics and exposes Prometheus-formatted metrics endpoint.
- 94e08b3: Implement chunked transaction processing for large genesis files. Genesis array processing now commits transactions every 5 chunks (5000 entries) to prevent timeouts. Improves handling of large genesis files with better memory management and transaction boundaries.
- 650be42: Add comprehensive configuration validation at startup. New validation utilities check:

  - RPC URL format and protocol (http/https/ws/wss)
  - Database connection string format (PostgreSQL)
  - File path existence and readability (genesis files)
  - Port numbers (1-65535 range)
  - Positive integers for batch sizes, heights, and intervals

  Validation occurs in constructors before initialization, providing early error detection with detailed error messages using the new ConfigurationError class. This prevents runtime failures and improves debugging experience.

- 4684983: Add custom error classes with context for better error tracking and debugging. New error classes include:

  - IndexerError: Base error class with code and context fields
  - ConfigurationError: Invalid or missing configuration
  - RPCError: RPC connection and communication failures (includes endpoint and height)
  - DatabaseError: Database operation failures (includes operation and query)
  - BlockProcessingError: Block data validation and processing errors (includes height)
  - ModuleError: Module initialization failures (includes module name)
  - GenesisError: Genesis file parsing errors (includes file path)

  All error classes extend the base IndexerError with proper stack traces and additional context data for easier debugging and monitoring.

- 667aff1: Extract magic numbers to named constants with comprehensive documentation. Created new constants module containing:

  - DEFAULT_BATCH_SIZE (500): Block prefetch queue size
  - DEFAULT_START_HEIGHT (1): Initial indexing height
  - DEFAULT_HEALTH_CHECK_PORT (8080): Health check server port
  - DEFAULT_POLLING_INTERVAL_MS (5000): RPC polling interval
  - RPC_TIMEOUT_MS (20000): Timeout for RPC calls
  - QUEUE_DEQUEUE_TIMEOUT_MS (30000): Queue operation timeout
  - DB_CLIENT_RECYCLE_COUNT (1500): Database connection recycling threshold
  - PERIODIC_INTERVALS: Event emission intervals (50, 100, 1000 blocks)
  - PAGINATION_LIMITS: Query pagination sizes (VALIDATORS: 1000n, DELEGATIONS: 250n)
  - GENESIS_BATCH_SIZE (1000): Genesis file processing batch size

  All magic numbers throughout the codebase now reference these documented constants, improving code maintainability and making configuration tuning easier.

- 0c28da7: Replace process.exit() calls with graceful shutdown via fatal-error event emission. Allows parent processes to handle shutdown logic in containerized environments. Added fatal-error event type with error context including message and retry count.
- d069ac2: Replace console.error in promise queues with proper winston logger integration. Queue classes (PromiseQueue and CircularBuffer) now accept an optional error handler callback that gets called when enqueue failures occur. The indexer passes a logger-based error handler to queues, ensuring consistent logging throughout the application.

  Breaking change: Queue constructor signatures now accept optional second parameter for error handling. Existing code without error handlers will continue to work (backward compatible), but enqueue errors will be silently ignored instead of using console.error.

  Logger is now initialized before queue creation to enable proper error handling integration.

### Patch Changes

- ef4dbba: Make health check HTTP server port configurable via `healthCheckPort` config option or `HEALTH_CHECK_PORT` environment variable. Defaults to port 8080 instead of port 80 to avoid requiring root privileges on Unix systems.
- 716a94e: Wire up prometheus
- f99b55b: Add environment variable validation for CHAIN_PREFIX. Chain prefix is now validated at module initialization to ensure it:

  - Is a non-empty string
  - Starts with a lowercase letter
  - Contains only lowercase letters and numbers

  The validated prefix is cached in each module (StakingModule and FullBlocksModule) for consistent use throughout, replacing direct process.env access. This prevents invalid chain addresses from being generated at runtime.

- 99e1fdf: Collect additional metrics
- 2bcd52c: Update Indexer Config types

## 2.10.0-next.3

### Patch Changes

- Collect additional metrics

## 2.10.0-next.2

### Patch Changes

- Update Indexer Config types

## 2.10.0-next.1

### Patch Changes

- Wire up prometheus

## 2.10.0-next.0

### Minor Changes

- e510e50: Add Prometheus metrics export for production monitoring. Created IndexerMetrics class with metrics for blocks indexed, queue depth, error rates, and processing durations. Includes default Node.js metrics and exposes Prometheus-formatted metrics endpoint.
- 94e08b3: Implement chunked transaction processing for large genesis files. Genesis array processing now commits transactions every 5 chunks (5000 entries) to prevent timeouts. Improves handling of large genesis files with better memory management and transaction boundaries.
- 650be42: Add comprehensive configuration validation at startup. New validation utilities check:

  - RPC URL format and protocol (http/https/ws/wss)
  - Database connection string format (PostgreSQL)
  - File path existence and readability (genesis files)
  - Port numbers (1-65535 range)
  - Positive integers for batch sizes, heights, and intervals

  Validation occurs in constructors before initialization, providing early error detection with detailed error messages using the new ConfigurationError class. This prevents runtime failures and improves debugging experience.

- 4684983: Add custom error classes with context for better error tracking and debugging. New error classes include:

  - IndexerError: Base error class with code and context fields
  - ConfigurationError: Invalid or missing configuration
  - RPCError: RPC connection and communication failures (includes endpoint and height)
  - DatabaseError: Database operation failures (includes operation and query)
  - BlockProcessingError: Block data validation and processing errors (includes height)
  - ModuleError: Module initialization failures (includes module name)
  - GenesisError: Genesis file parsing errors (includes file path)

  All error classes extend the base IndexerError with proper stack traces and additional context data for easier debugging and monitoring.

- 667aff1: Extract magic numbers to named constants with comprehensive documentation. Created new constants module containing:

  - DEFAULT_BATCH_SIZE (500): Block prefetch queue size
  - DEFAULT_START_HEIGHT (1): Initial indexing height
  - DEFAULT_HEALTH_CHECK_PORT (8080): Health check server port
  - DEFAULT_POLLING_INTERVAL_MS (5000): RPC polling interval
  - RPC_TIMEOUT_MS (20000): Timeout for RPC calls
  - QUEUE_DEQUEUE_TIMEOUT_MS (30000): Queue operation timeout
  - DB_CLIENT_RECYCLE_COUNT (1500): Database connection recycling threshold
  - PERIODIC_INTERVALS: Event emission intervals (50, 100, 1000 blocks)
  - PAGINATION_LIMITS: Query pagination sizes (VALIDATORS: 1000n, DELEGATIONS: 250n)
  - GENESIS_BATCH_SIZE (1000): Genesis file processing batch size

  All magic numbers throughout the codebase now reference these documented constants, improving code maintainability and making configuration tuning easier.

- 0c28da7: Replace process.exit() calls with graceful shutdown via fatal-error event emission. Allows parent processes to handle shutdown logic in containerized environments. Added fatal-error event type with error context including message and retry count.
- d069ac2: Replace console.error in promise queues with proper winston logger integration. Queue classes (PromiseQueue and CircularBuffer) now accept an optional error handler callback that gets called when enqueue failures occur. The indexer passes a logger-based error handler to queues, ensuring consistent logging throughout the application.

  Breaking change: Queue constructor signatures now accept optional second parameter for error handling. Existing code without error handlers will continue to work (backward compatible), but enqueue errors will be silently ignored instead of using console.error.

  Logger is now initialized before queue creation to enable proper error handling integration.

### Patch Changes

- ef4dbba: Make health check HTTP server port configurable via `healthCheckPort` config option or `HEALTH_CHECK_PORT` environment variable. Defaults to port 8080 instead of port 80 to avoid requiring root privileges on Unix systems.
- f99b55b: Add environment variable validation for CHAIN_PREFIX. Chain prefix is now validated at module initialization to ensure it:

  - Is a non-empty string
  - Starts with a lowercase letter
  - Contains only lowercase letters and numbers

  The validated prefix is cached in each module (StakingModule and FullBlocksModule) for consistent use throughout, replacing direct process.env access. This prevents invalid chain addresses from being generated at runtime.

## 2.9.9

### Patch Changes

- 378e461: Minor bug fixes

## 2.9.8

### Patch Changes

- fix: RPC exception handling

## 2.9.7

### Patch Changes

- chore: fix healthcheck db name

## 2.9.6

### Patch Changes

- Add RPC timeout

## 2.9.5

### Patch Changes

- fix events buf

## 2.9.4

### Patch Changes

- Debug indexer

## 2.9.3

### Patch Changes

- Fix events for comet38

## 2.9.2

### Patch Changes

- efd78ac: Fix comet 38 events
- 8631218: Polling fix

## 2.9.1

### Patch Changes

- b68bcda: Added changesets versioning
