# @eclesia/basic-pg-indexer

## 2.10.0

### Minor Changes

- a2e5741: Add comprehensive integration tests for PgIndexer covering connection handling, transaction lifecycle, database client recycling, height tracking, genesis processing, and error recovery. Tests are organized into focused modules with 40 tests total.

### Patch Changes

- ac6b158: Add prometheus config options to PgIndexer
- 650be42: Add comprehensive configuration validation at startup. New validation utilities check:

  - RPC URL format and protocol (http/https/ws/wss)
  - Database connection string format (PostgreSQL)
  - File path existence and readability (genesis files)
  - Port numbers (1-65535 range)
  - Positive integers for batch sizes, heights, and intervals

  Validation occurs in constructors before initialization, providing early error detection with detailed error messages using the new ConfigurationError class. This prevents runtime failures and improves debugging experience.

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

- 6ca0d6b: Fix database client recycling counter to only increment on successful transaction commits. Previously, the counter would increment even on rollbacks or errors, leading to inaccurate recycling timing and potentially premature client resets.
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

- Add prometheus config options to PgIndexer

## 2.10.0-next.0

### Minor Changes

- a2e5741: Add comprehensive integration tests for PgIndexer covering connection handling, transaction lifecycle, database client recycling, height tracking, genesis processing, and error recovery. Tests are organized into focused modules with 40 tests total.

### Patch Changes

- 650be42: Add comprehensive configuration validation at startup. New validation utilities check:

  - RPC URL format and protocol (http/https/ws/wss)
  - Database connection string format (PostgreSQL)
  - File path existence and readability (genesis files)
  - Port numbers (1-65535 range)
  - Positive integers for batch sizes, heights, and intervals

  Validation occurs in constructors before initialization, providing early error detection with detailed error messages using the new ConfigurationError class. This prevents runtime failures and improves debugging experience.

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

- 6ca0d6b: Fix database client recycling counter to only increment on successful transaction commits. Previously, the counter would increment even on rollbacks or errors, leading to inaccurate recycling timing and potentially premature client resets.

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
