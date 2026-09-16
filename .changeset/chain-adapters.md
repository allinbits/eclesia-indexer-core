---
"@eclesia/indexer-engine": major
"@eclesia/basic-pg-indexer": major
"@eclesia/chain-cosmos": major
"@eclesia/cosmos-modules-pg": major
"@eclesia/core-modules-pg": major
"create-eclesia-indexer": major
---

The engine is now chain-agnostic. Everything Cosmos-specific (cosmjs clients, block and
result fetching, the validator set, the block-to-events decomposition, gentx import, the mock
CometBFT node) moved into the new `@eclesia/chain-cosmos` package, and the engine gained a
`ChainAdapter` contract that any chain can implement. Versions jump to 4.0.0 because 3.0.0 was
already published from an earlier gno branch.

Breaking changes:

- `chain` is a required config field on `EclesiaIndexer` and `PgIndexer`. Cosmos indexers pass
  `chain: cosmos()` from `@eclesia/chain-cosmos`.
- `EclesiaIndexer`, `PgIndexer`, `EclesiaIndexerConfig`, `PgIndexerConfig` and `IndexingModule`
  are generic over the adapter (`EclesiaIndexer<CosmosAdapter>`); `indexer.client` and
  `indexer.blockClient` are typed as the adapter's client.
- `@eclesia/core-modules-pg` is renamed to `@eclesia/cosmos-modules-pg`. The old name is
  published once more as a deprecated re-export and will not be published again.
- The engine no longer depends on cosmjs. `Mocks.MockRpcClient` / `Mocks.createMockRpcClient`
  moved to `@eclesia/chain-cosmos` (`Mocks` namespace); the engine's `Mocks` now holds the
  chain-independent `syntheticChain()` adapter. Tests and benchmarks that set `engine.client`
  directly should use `cosmos({ connect: async () => mock })` instead.
- The Cosmos block events (`block`, `begin_block`, `tx_events`, `tx_memo`, `end_block`) and
  `TxResult` are declared by `@eclesia/chain-cosmos`; the engine's `Types.Events` keeps only
  `log`, `uuid`, `fatal-error`, `_unhandled` and the `periodic/*` ticks.
- The misspelled `EcleciaIndexer` / `EcleciaIndexerConfig` aliases are removed.
- When an adapter has no block subscription, or cannot subscribe with the configured endpoint,
  the engine switches to polling on its own and logs a warning.
