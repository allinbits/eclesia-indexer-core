---
"@eclesia/indexer-engine": minor
---

- A block that fails `maxFailuresPerBlock` (default 5) times in a row after its data was fetched now emits `fatal-error` with the height instead of being retried forever; failures to fetch (RPC outages) keep the unlimited backoff.
- The main class and its config type are exported under their correct spelling, `EclesiaIndexer` and `EclesiaIndexerConfig`. `EcleciaIndexer` and `EcleciaIndexerConfig` remain as deprecated aliases until 3.0.
- New `onGenesisStart` and `onGenesisComplete` config hooks let the storage layer record genesis import progress.
- The mock RPC client produces CometBFT 0.38 shapes (`cometVersion: "0.38"`), answers the Validators, ModuleAccounts, AllBalances, Pool and Params ABCI queries with pagination, and rejects unknown paths with a code, so integration tests can run without a node.
