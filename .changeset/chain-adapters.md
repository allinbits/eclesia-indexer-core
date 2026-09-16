---
"@eclesia/indexer-engine": major
"@eclesia/basic-pg-indexer": major
"@eclesia/chain-cosmos": major
"@eclesia/chain-gno": major
"@eclesia/gno-modules-pg": major
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

New in 4.0.0: `@eclesia/chain-gno`, a chain adapter for gno.land and other Tendermint2 chains
(`gno()`), built on `@gnolang/tm2-rpc` and `@gnolang/gno-types`. It emits `block`,
`begin_block`, one `tx` per transaction, one decoded event per message (`/bank.MsgSend`,
`/vm.m_call`, `/vm.m_addpkg`, `/vm.m_run`) and `end_block`, imports genesis transactions as
`gentx<@type>` events, and ships a mock Tendermint2 node. The engine's `Mocks` namespace gains
`adapterContractCases()`, behavioural checks every chain adapter must pass.

New in 4.0.0: `@eclesia/gno-modules-pg`, PostgreSQL modules for gno.land on the gno adapter:
`Blocks.FullBlocksModule` / `Blocks.MinimalBlocksModule` (blocks, transactions with decoded
messages, block-time averages), `MessagesModule` (bank sends, realm calls, deployments, runs,
and every chain event with its realm in `gno_events`), `PackagesModule` (a registry of packages
and realms with their sources, from transactions and from genesis) and `ValidatorsModule`
(the validator set block by block with power history, full mode).

Known upstream issue for gno consumers: `@gnolang/tm2-rpc` 1.0.0 decodes bech32 through
`@cosmjs/encoding` 0.38/0.39, which pass an unbounded length to `@scure/base`; `@scure/base`
2.3.0 and later reject it, so a fresh install fails on every `status()` and `validators()`
call with "limit: expected safe integer, got Infinity". This workspace pins
`@scure/base@>=2.3.0` to 2.2.0 through a pnpm override; consumers need the same override
(pnpm `overrides` or npm `overrides`) until tm2-rpc or cosmjs ships a fix.

Two more mainnet findings handled in the gno adapter: `gno()` takes `requestsPerSecond` (paces
HTTP requests) and `batching` (packs JSON-RPC calls into batch requests, on by default with a
rate limit), because rpc.gno.land allows about a thousand requests per five minutes; and the
adapter decodes `block_results` itself, since tm2-rpc's event decoder throws on the bank
module's `/bank.TransferEvent`, which has no realm `pkg_path`. Full mode also caches the
validator set by the header's `validatorsHash`, so it costs two calls per block, not three.

gno.land's package approval flow (`code_submission_policy: inert`) is covered: the adapter
decodes `/vm.m_enable_pkg` and `/vm.m_reject_pkg`, and the auth module's session messages
(`/auth.m_create_session`, `/auth.m_revoke_session`, `/auth.m_revoke_all_sessions`), through
`@gnolang/gno-types` 1.1.0; the messages module gets `vm_enable_packages` and `vm_reject_packages`;
the packages module gets the approval columns and a generated `status` (`submitted`,
`enabled`, `rejected`). Unknown message types are now warned about once per type instead of
logged at debug level per transaction.

Every decoded gno transaction now carries its `signers`, `feePayer`, `sessionAddress` and
`decoded` messages, and the full blocks module stores signers and session address per
transaction. Two more gno modules: `SessionsModule` (session keys with derived addresses,
limits and revocation) and `BankModule` (transfer events, and exact balances read from the
node for every address a block touches, with genesis balances and a change history). The
mock Tendermint2 node cycles through all nine message types and emits transfer events.
