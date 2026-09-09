# @eclesia/core-modules-pg

## 2.16.1

### Patch Changes

- [#36](https://github.com/allinbits/eclesia-indexer-core/pull/36) [`fc6d826`](https://github.com/allinbits/eclesia-indexer-core/commit/fc6d826416fc129e6fb6cfd2f0e3841ca3687373) Thanks [@clockworkgr](https://github.com/clockworkgr)! - Bank: mints and burns are no longer counted twice. The SDK's bank keeper emits `coin_received` for a mint and `coin_spent` for a burn, and then emits `coinbase` / `burn` in addition; the module applied both, so a minting module account gained the minted amount every block (the AtomOne mint account showed 5,500 ATONE after 1,700 blocks where the chain shows 0) and burned deposits were subtracted twice. Only `coin_spent` and `coin_received` move balances now. On CometBFT 0.38 chains this was hidden until 2.16.0 because begin-block events were dropped entirely before the `mode` attribute fix; on 0.37 chains it affected every mint and burn.

- Updated dependencies []:
  - @eclesia/indexer-engine@2.16.1
  - @eclesia/basic-pg-indexer@2.16.1

## 2.16.0

### Minor Changes

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - - Every module's schema is now a set of numbered migrations applied through `PgIndexer.applyMigrations`. The previous `module.sql` files became migration 001; existing databases are baselined automatically.

  - Migration 002 (blocks): block timestamps are stored as `TIMESTAMPTZ`, so values no longer depend on the indexer host's time zone. Existing rows are reinterpreted in the database session's time zone.
  - Migration 002 (staking): `voting_power` and `min_self_delegation` become `NUMERIC` (18-decimal chains overflowed `BIGINT`), `staking_pool` is unique per height instead of per token pair, lookup indexes are added for the latest-row queries on descriptions, commissions and voting powers, and a duplicate index is dropped.
  - The `EventMap` augmentation for module events is emitted into the published types.

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - Staking module fixes:

  - `MsgUndelegate` is handled: the newest staked balance for the delegator/validator pair is reduced by the undelegated tokens and shares (floored at zero). `MsgCancelUnbondingDelegation` returns the tokens to the delegation. Both were previously ignored, so balances only ever grew.
  - Re-creating a validator after it was removed no longer fails on a unique violation: `validator_infos` and `validators` are upserted and any other active consensus key for the operator is retired first.
  - `delegate()` no longer drops a delegation when the validator is missing from the in-memory cache; it falls back to the recorded voting power and, for a validator with no recorded power yet, a 1:1 share rate.
  - Commission rates and limits from `MsgCreateValidator` and `MsgEditValidator` are stored on the same decimal scale as genesis values (protobuf `LegacyDec` values are rescaled from 18-decimal integers), via the new `fromLegacyDec` helper.
  - Slashing re-sync reads the unbonding period from either stored params shape (genesis snake_case or proto JSON) and treats it as seconds, not milliseconds; `MsgUpdateParams` is recorded; and when no params are stored the chain is queried once instead of failing the block.

### Patch Changes

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - - Bank: a spend on a denom the account has never been seen holding is recorded as a negative delta instead of a positive balance.

  - Auth: module account balances are snapshotted as of the end of block 1 once block 2 starts, so block 1's own flows are no longer counted twice, and the accounts are discovered through the `ModuleAccounts` query with the well-known names as a fallback for older chains.
  - Staking: `checkAndSaveValidators` skips only validators without a consensus address yet; database errors now fail the block instead of being swallowed into an aborted transaction that committed as empty.
  - Staking: `updateDelegatorDelegations` follows pagination, so delegators with more than 100 delegations are refreshed completely after a slash.

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - - Consensus addresses for secp256k1 validator keys are derived as CometBFT does (ripemd160 of sha256); ed25519 keys are unchanged.

  - `MsgEditValidator` follows the SDK: only the `[do-not-modify]` sentinel keeps a description field, an empty string clears it. `avatar_url` is no longer filled with the identity string.
  - Event attributes that arrive as raw bytes (CometBFT 0.34) are stored as base64 in `transactions.logs` instead of one key per byte.
  - `getValidatorDescription` is the correctly spelt lookup; the old name remains as an alias. Prepared statement names are unique across modules. Two redundant indexes are dropped by migrations.

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - - `StakingModule` declares its dependency on `Blocks.FullBlocksModule` and refuses to set up without it, with an explanation, instead of failing on the first block insert.

  - The module-account fallback for chains without the `ModuleAccounts` query tolerates names the chain does not know.

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - Genesis import fixes:

  - Bank: accounts holding two or more denoms no longer abort the import. Balances were serialised as one malformed `COIN[]` literal; each account's coins are now sent as JSON and unpacked server-side, which also handles empty coin lists and any denom characters.
  - Auth: every genesis account shape is resolved (`address`, `base_account.address`, `base_vesting_account.base_account.address`), covering PeriodicVestingAccount, PermanentLockedAccount, EthAccount, InterchainAccount and similar wrappers. Unknown shapes are skipped with a warning instead of inserting NULL into the accounts primary key.
  - Staking: `app_state.staking.validators` reads `consensus_pubkey.key` and `consensus_pubkey["@type"]` as the SDK exports them; the previous `consensus_pubkey.pubkey.key` path threw on any exported-state genesis.
  - Staking: the validator cache rebuilt on restart is keyed by the active consensus address, matching every reader; it was keyed by operator address, so every validator missed on the first block after a restart.

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - Fix four staking "latest row" queries reading the genesis row instead of the newest one. `getValidatorCommission`, `getValidatorDescription`, `delegate()` and `redelegate()` used `ORDER BY height DESC LIMIT 1`, which in PostgreSQL sorts NULL heights first; rows written from genesis/gentx have a NULL height, so any delegator or validator with a genesis row always read that row. The `(height DESC NULLS LAST)` index does not change query semantics. The queries now specify `NULLS LAST`, matching the voting-power and staking-params lookups in the same module.

- Updated dependencies [[`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f), [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f)]:
  - @eclesia/basic-pg-indexer@2.16.0
  - @eclesia/indexer-engine@2.16.0

## 2.15.1

### Patch Changes

- 7e721b5: `getConsensusAddress` now falls back to the `validators` table on a cache miss (instead of immediately throwing "No consensus address"), so an evicted `validatorAddressCache` (LRU, capped at 1000) entry or a not-yet-warmed cache after a restart no longer crashes block processing. It only throws when the validator is genuinely absent from the database.

## 2.15.0

### Minor Changes

- 10c0226: Handle `MsgRotateConsPubKey` in the staking module: append the new consensus key to `validators` (now carrying `operator_address`, `is_active`, and `height`), deactivate the previous key, and carry live delegations over to the new consensus address. `validator_infos.consensus_address` is dropped in favour of the operator↔consensus mapping now held on `validators`.

## 2.14.3

### Patch Changes

- 95bdc3a: Improve insert performance

## 2.14.2

### Patch Changes

- 49c4028: Better stringify performance

## 2.14.1

### Patch Changes

- 2091bb8: ensure we only increment retry counter once

## 2.14.0

### Minor Changes

- b7ed332: Refactor indexer flow

## 2.13.0

### Minor Changes

- 9d237a5: Add RPC connect timeout

## 2.12.1

### Patch Changes

- Fix saveTx

## 2.12.0

### Minor Changes

- Fix metrics and increase save TX performance

## 2.11.0

### Minor Changes

- Benchmark improvements and RPC bug

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
