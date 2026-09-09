# @eclesia/indexer-engine

## 2.16.2

### Patch Changes

- [#38](https://github.com/allinbits/eclesia-indexer-core/pull/38) [`b514c34`](https://github.com/allinbits/eclesia-indexer-core/commit/b514c3428b44dd0b0774d5b99d52aea0c7ce7628) Thanks [@clockworkgr](https://github.com/clockworkgr)! - Fix a restart loop after an RPC failure in WebSocket mode. Every restart disconnects the previous client, which completes the previous block subscription; that completion requested a recovery against the run that was just starting, so each attempt died immediately and the backoff grew to five minutes. Seen on AtomOne after a burst of block-fetch timeouts: 23 consecutive "block subscription closed by the node" recoveries with no block processed. The subscription listener now carries the generation it was created for, and the previous subscription is detached before the socket is closed.

## 2.16.1

## 2.16.0

### Minor Changes

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - Resilience, logging and typing:

  - An idle chain is no longer an error. When caught up, the indexer waits for the next block without a timeout and without holding a database transaction, reports `WAITING` on the health endpoint (HTTP 200) and in the new `indexer_waiting_for_blocks` gauge, and checks the chain height every 30 s. Recovery is triggered only when the chain has advanced without a block being announced (a dead subscription) or the RPC is unreachable.
  - Restarts use exponential backoff from 5 s up to 5 min and are unlimited by default; set `maxRetries` to restore a fatal-error after a fixed number of consecutive failures. Callbacks left over from a previous run can no longer trigger a recovery in the current one.
  - Logging goes to stdout only. The `error.log` / `combined.log` files in the working directory are gone. Errors keep their stack, `logFormat: "json"` selects JSON output, and the RPC URL is logged with its password masked.
  - `healthCheckHost` and `prometheusHost` control the bind address of the two HTTP servers (default `0.0.0.0`).
  - `endHeight` is honoured exactly: the block at `endHeight` is the last one processed and the fetcher stops there.
  - The global `EventMap` declaration is now emitted into the published types, so consumers get typed `on()` handlers without declaring it themselves.
  - Genesis parsing moved to stream-json 3 and stream-chain 4, clearing the last production audit advisory. The genesis progress counter now reports real numbers.
  - A `shouldProcessGenesis()` result of true with no `genesisPath` is logged as a warning instead of being skipped silently.

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - Live-block and lifecycle fixes:

  - WebSocket mode now fetches every height between the last one seen and the announced one, so a NewBlock event skipped by the subscription no longer leaves a permanent hole. Heights at or below the last one seen are ignored instead of moving the cursor backwards.
  - Polling mode keeps exactly one polling chain across recoveries; previously every restart added another concurrent poller.
  - `stop()` is now async and actually tears the indexer down: subscription, polling and inactivity timers, both RPC clients and the health and metrics servers. Reaching `endHeight` lets the process exit.
  - `asyncEmit` removes its per-call `uuid` listener when a handler rejects; it used to leak one listener per failed event for the life of the process. A completion ack that arrives after its emit already rejected is now dropped instead of being re-emitted into a recursion.
  - Every RPC and queue timeout clears its timer once the race settles (new `Utils.withTimeout`), the connect step has its own timeout per client and disconnects a client that arrives late, and timeouts reject with an `RPCError` instead of an empty array or `false`.

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - - Event handlers now run one after another in registration order. They share one database connection and one transaction, so interleaving them at await points let two handlers touch the same rows in an unpredictable order, and a failure in one left the others mid-flight during the rollback. The uuid acknowledgement protocol that `asyncEmit` used internally is gone; `emit()` and `on()` are unchanged. `EclesiaEmitter.handlersFor()` exposes the registered handlers.

  - A block subscription that errors or is closed by the node now triggers a recovery instead of going unnoticed until the idle check.
  - A transaction log that is not JSON, or a single-message transaction without a log or `msg_index` attributes, no longer fails the block.
  - New `chainId` option: the indexer refuses to start against an RPC that reports a different network.
  - The RPC call duration metric is recorded for failed queries too. `PromiseQueue` is deprecated; the unused `dayjs` and `uuid` dependencies and the `start` script are removed.

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - - A block that fails `maxFailuresPerBlock` (default 5) times in a row after its data was fetched now emits `fatal-error` with the height instead of being retried forever; failures to fetch (RPC outages) keep the unlimited backoff.
  - The main class and its config type are exported under their correct spelling, `EclesiaIndexer` and `EclesiaIndexerConfig`. `EcleciaIndexer` and `EcleciaIndexerConfig` remain as deprecated aliases until 3.0.
  - New `onGenesisStart` and `onGenesisComplete` config hooks let the storage layer record genesis import progress.
  - The mock RPC client produces CometBFT 0.38 shapes (`cometVersion: "0.38"`), answers the Validators, ModuleAccounts, AllBalances, Pool and Params ABCI queries with pagination, and rejects unknown paths with a code, so integration tests can run without a node.

### Patch Changes

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - - `callABCI` honours the ABCI response code. An error reply (pruned height, unknown path) is thrown as an `RPCError` carrying the code and log instead of decoding as an empty result; it no longer triggers a recovery for ad-hoc module queries, which can catch it.

  - The validator set is fetched with pagination, so chains with more than 1000 validators are no longer truncated.
  - An `http(s)://` RPC URL with `usePolling: false` now switches to polling with a warning at construction time instead of failing after several restarts.
  - Explicit `undefined` configuration values no longer override the defaults.
  - Live blocks go through the same fetcher as the initial catch-up, which waits for queue space instead of overwriting or restarting when the queue is full at the sync boundary.
  - `EclesiaEmitter.off()` only removes handlers that were registered and supports the same handler registered more than once; `CircularBuffer` refuses to overwrite when full and throws on a dequeue without a pending item.

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - Fix `begin_block` / `end_block` events being empty on CometBFT 0.38 / Cosmos SDK 0.50+ chains. The engine filtered `finalize_block_events` on `mode == "begin_block"` / `"end_block"`, but the SDK stamps `mode=BeginBlock` / `mode=EndBlock` (baseapp.go), so no event ever matched and bank, staking and any custom begin/end-block handlers received empty event lists. The comparison now matches the SDK's spelling (and still accepts the snake_case forms) via the new `Utils.hasBlockEventMode` helper.

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - Genesis import no longer crashes the process when a `genesis/*` handler or the JSON parser fails. The stream chains had no `error` listener, so any failure surfaced as an uncaught exception and the surrounding transaction was never rolled back. Errors now reject the reader, `parseGenesis` rolls back, and the cause is logged.

## 2.14.5

### Patch Changes

- 10c0226: Better RPC connect/disconnect handling and logging

## 2.14.2

### Patch Changes

- 2091bb8: ensure we only increment retry counter once

## 2.14.1

### Patch Changes

- 68a9454: catch block listening setup error

## 2.14.0

### Minor Changes

- b7ed332: Refactor indexer flow

## 2.13.0

### Minor Changes

- 9d237a5: Add RPC connect timeout

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
