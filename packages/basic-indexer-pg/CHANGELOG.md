# @eclesia/basic-pg-indexer

## 2.16.2

### Patch Changes

- Updated dependencies [[`b514c34`](https://github.com/allinbits/eclesia-indexer-core/commit/b514c3428b44dd0b0774d5b99d52aea0c7ce7628)]:
  - @eclesia/indexer-engine@2.16.2

## 2.16.1

### Patch Changes

- Updated dependencies []:
  - @eclesia/indexer-engine@2.16.1

## 2.16.0

### Minor Changes

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - - On `fatal-error` the indexer stops and exits the process with code 1; `exitOnFatal: false` opts out.

  - Genesis imports are recorded in a `genesis_import` table. A start on top of a partial import is refused with an explanation instead of importing again; a completed import is never repeated even before the first block is stored.
  - The silly-mode client is a proxy that times `query()` and forwards every other method, so modules see the same client shape at every log level.
  - Client recycling runs only after a successful commit and outside the transaction error handling, so a recycling failure no longer masks a commit or rollback error.
  - `run()` no longer opens a separate RPC connection before `start()` opens its own.

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - Every database client is now built by one factory with `error` and `end` listeners attached, and a reconnect after a dropped or failed connection always uses a fresh client. Previously the reconnect path created listener-less clients (a second disconnect crashed the process with an unhandled `error` event) and `beginTransaction` tried to reconnect a client node-postgres refuses to reuse. Adds `PgIndexer.stop()`, which stops the engine and closes the database connection.

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - - `PgIndexer.applyMigrations(module, migrations, baselineTable)` and `loadMigrations(dir)` add versioned schema migrations recorded in a `schema_migrations` table. A database created before migrations existed is baselined at version 1 without re-running it, so existing deployments upgrade in place.
  - `synchronous_commit` is now set once per connection instead of on every `getInstance()` call, and `synchronousCommit: true` keeps it on.
  - `getNextHeight()` and `shouldProcessGenesis()` fall back to the engine's default start height when `startHeight` is omitted instead of returning `undefined`.

### Patch Changes

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - Declare `@eclesia/indexer-engine` as a runtime dependency (it was a devDependency, so consumers had to install it themselves) and drop nine dependencies this package never imports.

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - `addModules()` rejects a duplicate module name and any module added after `setup()`, which would otherwise be registered without its schema.

- Updated dependencies [[`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f)]:
  - @eclesia/indexer-engine@2.16.0

## 2.14.1

### Patch Changes

- 95bdc3a: Improve insert performance

## 2.14.0

### Minor Changes

- b7ed332: Refactor indexer flow

## 2.13.0

### Minor Changes

- 9d237a5: Add RPC connect timeout

## 2.12.0

### Minor Changes

- Fix metrics and increase save TX performance

## 2.11.2

### Patch Changes

- Fix type export

## 2.11.1

### Patch Changes

- Refactor PgIndexerConfig type

## 2.11.0

### Minor Changes

- Benchmark improvements and RPC bug

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
