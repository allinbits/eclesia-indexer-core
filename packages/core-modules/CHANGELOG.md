# @eclesia/core-modules-pg

## 2.10.0

### Minor Changes

- 36c5bf5: Add LRU cache for validator address lookups to prevent unbounded memory growth. Replaced Map-based caches with LRUCache (max 1000 validator addresses, max 500 validator data entries). Reduces database queries and improves performance for validator lookups.
- 83f8158: Add comprehensive unit tests for Auth, Bank, and Staking modules covering module initialization, setup, database operations, and event handling. Tests validate core functionality with proper mocking of dependencies.

### Patch Changes

- f99b55b: Add environment variable validation for CHAIN_PREFIX. Chain prefix is now validated at module initialization to ensure it:

  - Is a non-empty string
  - Starts with a lowercase letter
  - Contains only lowercase letters and numbers

  The validated prefix is cached in each module (StakingModule and FullBlocksModule) for consistent use throughout, replacing direct process.env access. This prevents invalid chain addresses from being generated at runtime.

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

- d771ab8: Replace any types in staking module with proper typed interfaces for genesis data structures including GenesisPubkey, GenesisCreateValidator, GenesisStakingParams, and GenesisValidator. Improves type safety and removes all eslint-disable comments for explicit any.
- 99e1fdf: Collect additional metrics
- 2198fc9: Replace silent error catch in StakingModule with proper debug logging. Errors when checking validator status now log at debug level with context about the validator address and reason for the error (likely validator created in current block).

## 2.10.0-next.1

### Patch Changes

- Collect additional metrics

## 2.10.0-next.0

### Minor Changes

- 36c5bf5: Add LRU cache for validator address lookups to prevent unbounded memory growth. Replaced Map-based caches with LRUCache (max 1000 validator addresses, max 500 validator data entries). Reduces database queries and improves performance for validator lookups.
- 83f8158: Add comprehensive unit tests for Auth, Bank, and Staking modules covering module initialization, setup, database operations, and event handling. Tests validate core functionality with proper mocking of dependencies.

### Patch Changes

- f99b55b: Add environment variable validation for CHAIN_PREFIX. Chain prefix is now validated at module initialization to ensure it:

  - Is a non-empty string
  - Starts with a lowercase letter
  - Contains only lowercase letters and numbers

  The validated prefix is cached in each module (StakingModule and FullBlocksModule) for consistent use throughout, replacing direct process.env access. This prevents invalid chain addresses from being generated at runtime.

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

- d771ab8: Replace any types in staking module with proper typed interfaces for genesis data structures including GenesisPubkey, GenesisCreateValidator, GenesisStakingParams, and GenesisValidator. Improves type safety and removes all eslint-disable comments for explicit any.
- 2198fc9: Replace silent error catch in StakingModule with proper debug logging. Errors when checking validator status now log at debug level with context about the validator address and reason for the error (likely validator created in current block).

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
