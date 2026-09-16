# Eclesia Indexer Core

A powerful, modular framework for indexing blockchain data. One chain-agnostic engine, a chain adapter per chain family, PostgreSQL storage and ready-made modules. Today it indexes any Cosmos SDK chain (CometBFT 0.34 to 0.38) and gno.land (Tendermint2); adding a chain means implementing one adapter interface.

Upgrading from 2.x? See [MIGRATION.md](MIGRATION.md).

## Key Features

- Chain-agnostic engine with typed chain adapters (Cosmos SDK, gno.land)
- Modular Architecture
- Event-Driven Block Processing
- PostgreSQL-Optimized Storage Layer
- Production-Ready Developer CLI

## 🚀 Quick Start

```bash
# Create a new indexer project
npx create-eclesia-indexer@latest

# Configure your chain and follow the instructions to build a postgres-based indexer
```

More information in our tutorials: [Simple](TUTORIAL.md) and [Advanced](ADVANCED_TUTORIAL.md)

## 📦 Architecture

Eclesia is a monorepo of packages in three layers: a chain-agnostic engine, one adapter per chain family, and the storage and modules built on them.

```
┌─────────────────────┐    ┌──────────────────────┐
│ create-eclesia-     │    │ @eclesia/            │
│ indexer             │───▶│ indexer-engine       │  chain-agnostic: queue, recovery,
│ (CLI scaffolding)   │    │ (Core engine)        │  transactions, events, metrics
└─────────────────────┘    └──────────┬───────────┘
                                      │ ChainAdapter
                  ┌───────────────────┴───────────────────┐
        ┌─────────▼──────────┐               ┌────────────▼─────────┐
        │ @eclesia/          │               │ @eclesia/            │
        │ chain-cosmos       │               │ chain-gno            │
        │ (cosmjs, CometBFT) │               │ (tm2-rpc, gno-types) │
        └─────────┬──────────┘               └────────────┬─────────┘
                  │        ┌──────────────────────┐       │
                  └───────▶│ @eclesia/            │◀──────┘
                           │ basic-pg-indexer     │
                           │ (PostgreSQL impl)    │
                           └──────────┬───────────┘
                  ┌───────────────────┴───────────────────┐
        ┌─────────▼──────────┐               ┌────────────▼─────────┐
        │ @eclesia/          │               │ @eclesia/            │
        │ cosmos-modules-pg  │               │ gno-modules-pg       │
        │ (auth, bank, ...)  │               │ (messages, pkgs, ...)│
        └────────────────────┘               └──────────────────────┘
```

### Package Responsibilities

| Package | Purpose | Usage |
|---------|---------|-------|
| **`@eclesia/indexer-engine`** | Chain-agnostic engine: fetch pipeline, recovery, per-block transactions, event dispatch, metrics; defines the `ChainAdapter` contract | Foundation for all indexers |
| **`@eclesia/chain-cosmos`** | Cosmos SDK adapter: cosmjs clients, block and validator-set fetching, the block-to-events decomposition, gentx import, a mock CometBFT node | Every Cosmos indexer |
| **`@eclesia/chain-gno`** | gno.land adapter: tm2-rpc client with request pacing and batching, decoded messages (`/bank.MsgSend`, `/vm.m_call`, `/vm.m_addpkg`, `/vm.m_run`, `/vm.m_enable_pkg`, `/vm.m_reject_pkg`), genesis import, a mock Tendermint2 node | Every gno indexer |
| **`@eclesia/basic-pg-indexer`** | PostgreSQL implementation: connection, transactions, migrations, module lifecycle | Most common use case |
| **`@eclesia/cosmos-modules-pg`** | Pre-built modules for Cosmos SDK chains (blocks, auth, bank, staking) | Ready-to-use indexing modules |
| **`@eclesia/gno-modules-pg`** | Pre-built modules for gno.land (blocks, messages and events, packages, validators) | Ready-to-use indexing modules |
| **`create-eclesia-indexer`** | CLI tool for scaffolding new indexer projects for either chain family | Getting started quickly |

`@eclesia/core-modules-pg` was renamed to `@eclesia/cosmos-modules-pg` in 4.0; the old name is published once more as a re-export.

## 🏗️ Core Concepts

### Chain Adapters

The engine never talks to a node itself. A chain adapter opens the RPC client, fetches whatever one block is on that chain, and decomposes it into typed events; the engine owns everything around that: the prefetch queue, timeouts and recovery, the per-block database transaction, genesis streaming, health and metrics.

```typescript
interface ChainAdapter<TClient, TBlock> {
  readonly name: string;
  connect(url: string): Promise<TClient>;
  disconnect(client: TClient): void | Promise<void>;
  status(client: TClient): Promise<{ network: string; latestHeight: number }>;
  subscribeNewBlock?(client: TClient, listener: BlockListener): Unsubscribe | null; // absent or null => the engine polls
  fetchBlock(client: TClient, height: number, ctx: FetchContext): Promise<FetchedBlock<TBlock>>;
  processBlock(block: FetchedBlock<TBlock>, ctx: ProcessContext): Promise<void>;   // emits the events modules listen to
  abciQuery?(client: TClient, path: string, data: Uint8Array, height?: number): Promise<AbciResult>;
  genesis?(ctx: GenesisContext): Promise<void>;
}
```

Adapters are passed to the indexer as `chain: cosmos()` or `chain: gno()`, and `EclesiaIndexer`, `PgIndexer` and `IndexingModule` are generic over them, so a gno module cannot be installed on a Cosmos indexer by mistake. Every adapter ships a mock node and must pass the engine's `Mocks.adapterContractCases()`.

### Event-Driven Architecture

Eclesia processes blockchain data by iterating through blocks and emitting events for different types of data. The event names are declared by the chain adapter:

- **Cosmos SDK**: `block`, `begin_block`, `tx_events`, `tx_memo`, one event per message type URL (for example `/cosmos.bank.v1beta1.MsgSend`), `end_block`
- **gno.land**: `block`, `begin_block`, `tx`, `/bank.MsgSend`, `/vm.m_call`, `/vm.m_addpkg`, `/vm.m_run`, `/vm.m_enable_pkg`, `/vm.m_reject_pkg`, `end_block`
- **Engine**: `periodic/small|medium|large`, `genesis/array/<path>`, `genesis/value/<path>`, `fatal-error`
- **Custom Events**: Modules add their own through the global `EventMap`

One chain adapter package per TypeScript project: two adapters declare `block` with different payloads, which the merged event map rejects.

### Modular Design

Create custom modules for the basic PG indexer by implementing the `IndexingModule` interface:

```typescript
interface IndexingModule<A extends ChainAdapter> {
  indexer: EclesiaIndexer<A>        // Reference to main indexer
  name: string                      // Unique module name
  depends: string[]                 // Dependencies on other modules
  provides: string[]                // Capabilities this module provides
  setup: () => Promise<void>        // Database schema setup
  init: (...args: any[]) => void   // Event listener registration
}
```

## 📋 Packages

### 🔧 Core Engine (`@eclesia/indexer-engine`)

The foundational package that provides the core indexing functionality, independent of any chain.

**Key Features:**
- Block pipeline and event emission through a chain adapter
- Subscription and polling support for real-time indexing
- Configurable batch processing
- Genesis state streaming
- Transaction management, recovery with backoff, health and Prometheus metrics
- The `ChainAdapter` contract and `Mocks.adapterContractCases()` for adapter authors

### ⛓️ Chain Adapters (`@eclesia/chain-cosmos`, `@eclesia/chain-gno`)

One package per chain family. `cosmos()` runs any Cosmos SDK chain through cosmjs and fetches the full validator set per block in full mode. `gno()` runs gno.land and other Tendermint2 chains through tm2-rpc, decoding every message with gno-types; Tendermint2 has no block subscription, so the engine polls. Both accept a `connect` option to supply a custom or mock client.

### 🐘 PostgreSQL Indexer (`@eclesia/basic-pg-indexer`)

A PostgreSQL-specific implementation of the indexer engine, perfect for most use cases.

**Key Features:**
- Built-in PostgreSQL connection management
- Transaction support with rollback capabilities
- Versioned schema migrations, applied on start and tracked per module
- Optimized for high-throughput indexing

### 🧩 Cosmos Modules (`@eclesia/cosmos-modules-pg`)

Pre-built indexing modules for common Cosmos SDK functionality.

**Available Modules:**
- **`Blocks`**: Blocks.Full :Block and transaction indexing or Blocks.Minimal: Height tracking 
- **`AuthModule`**: Account authentication data
- **`BankModule`**: Token transfers and balances
- **`StakingModule`**: Validator and delegation data. Requires `Blocks.FullBlocksModule` (its schema references the block proposer) and a genesis import from height 1, so every proposer is known

### 🧩 gno Modules (`@eclesia/gno-modules-pg`)

Pre-built indexing modules for gno.land.

**Available Modules:**
- **`Blocks`**: Blocks.Full: blocks, transactions with decoded messages and block-time averages, or Blocks.Minimal: height tracking
- **`MessagesModule`**: one table per message type (`bank_sends`, `vm_calls`, `vm_add_packages`, `vm_runs`, `vm_enable_packages`, `vm_reject_packages`) plus every chain event with the realm that emitted it in `gno_events`
- **`PackagesModule`**: registry of packages and realms with their sources, from deployments and from genesis, with the approval state (`submitted`, `enabled`, `rejected`) on chains that park deployments until an approver enables them
- **`ValidatorsModule`**: validator set block by block with a voting-power history. Needs full mode (`minimal: false`)

### 🛠️ Project Generator (`create-eclesia-indexer`)

CLI tool for scaffolding new indexer projects with best practices built-in.

**Features:**
- Interactive project setup
- Boilerplate code generation
- Configuration templates
- Docker and deployment setup

**Usage:**
```bash
npx create-eclesia-indexer@latest
```

## ⚙️ Configuration

The indexer is configured through the `EclesiaIndexerConfig` (or `PgIndexerConfig` for PostgreSQL) interface:

```typescript
const config: PgIndexerConfig<CosmosAdapter> = {
  // Chain adapter: cosmos() from @eclesia/chain-cosmos or gno() from @eclesia/chain-gno
  chain: cosmos(),

  // Block range
  startHeight: 1,                    // Starting block height
  endHeight?: number,                // Optional ending height

  // Performance
  batchSize: 300,                    // Blocks to prefetch and keep ready for processing

  // Chain connection
  rpcUrl: "https://rpc.cosmos.network",
  usePolling: false,                 // Use WebSocket (false) or polling (true)
  pollingInterval: 1000,             // Polling interval in ms

  // Database (PostgreSQL specific)
  dbConnectionString: "postgres://user:pass@localhost:5432/db",

  // Features
  modules: [],                       // Module names to enable
  minimal: false,                    // Minimal mode (lets the adapter skip per-block extras such as validator sets)
  processGenesis: false,             // Process genesis state
  genesisPath: "./genesis.json",     // Path to genesis file

  // Logging
  logLevel: "info",                  // Logging verbosity

  // Custom functions
  init?: () => Promise<void>,        // Custom initialization
  getNextHeight: () => Promise<number>, // Next block to process
  shouldProcessGenesis: () => Promise<boolean>, // Genesis processing check
}
```

## 🔄 Typical Workflow

### 1. Standard Workflow (Recommended)

```bash
# 1. Generate project
npx create-eclesia-indexer@latest

# 2. Configure for your chain
cd my-chain-indexer
# Edit project as needed

# 3. Choose your modules
# Use pre-built modules or create custom ones

# 4. Deploy
npm run build
npm start
```

### 2. Advanced Workflow (Custom Implementation)

For advanced users who need full control:

```typescript
import { cosmos, CosmosAdapter } from '@eclesia/chain-cosmos';
import { EclesiaIndexer, Types } from '@eclesia/indexer-engine';

const config: Types.EclesiaIndexerConfig<CosmosAdapter> = {
  chain: cosmos(),
  // Custom configuration
};

const indexer = new EclesiaIndexer(config);
// Custom event handlers and modules
await indexer.connect();
await indexer.start();
// ... later
await indexer.stop();
```

`setup()` and `run()` live on `PgIndexer` from `@eclesia/basic-pg-indexer`, which wraps the engine with a PostgreSQL connection, transactions and module setup.

## 📊 Example Implementation

Here's how the [AtomOne indexer](https://github.com/allinbits/atomone-indexer) uses Eclesia:

```typescript
import {
  atomoneProtoRegistry,
} from "@atomone/atomone-types/atomone/client.js";
import {
  defaultRegistryTypes,
} from "@cosmjs/stargate";
import {
  PgIndexer, PgIndexerConfig,
} from "@eclesia/basic-pg-indexer";
import {
  cosmos, CosmosAdapter,
} from "@eclesia/chain-cosmos";
import {
  AuthModule, BankModule, Blocks, StakingModule,
} from "@eclesia/cosmos-modules-pg";

import {
  GovModule,
} from "./modules/atomone.gov.v1beta1/index.js";

const config: PgIndexerConfig<CosmosAdapter> = {
  chain: cosmos(),
  startHeight: 1,
  batchSize: Number(process.env.QUEUE_SIZE) || 300,
  modules: [],
  rpcUrl: process.env.RPC_ENDPOINT || "https://rpc.atomone.network",
  logLevel: process.env.LOG_LEVEL as PgIndexerConfig<CosmosAdapter>["logLevel"] ?? "info",
  usePolling: false,
  pollingInterval: 0,
  processGenesis: process.env.PROCESS_GENESIS === "true" || false,
  minimal: false,
  genesisPath: "./genesis.json",
  dbConnectionString: process.env.PG_CONNECTION_STRING || "postgres://postgres:password@localhost:5432/atomone",
};

const registry = defaultRegistryTypes.concat(atomoneProtoRegistry);
const blocksModule = new Blocks.FullBlocksModule(registry);
const authModule = new AuthModule(registry);
const bankModule = new BankModule(registry);
const stakingModule = new StakingModule(registry);
const govModule = new GovModule(registry);
const indexer = new PgIndexer(config, [blocksModule, authModule, bankModule, stakingModule, govModule]);

process.on("unhandledRejection", (reason, promise) => {
  console.log("Unhandled Rejection at:", promise, "reason:", reason);
  console.trace();
  process.exit(1);
});
const run = async () => {
  try {
    await indexer.setup();
    await indexer.run();
  }
  catch (error) {
    console.error("Error running indexer:", error);
    process.exit(1);
  }
};
run();
```

And a gno.land indexer, against a local `gnodev` node:

```typescript
import { PgIndexer, PgIndexerConfig } from "@eclesia/basic-pg-indexer";
import { gno, GnoAdapter } from "@eclesia/chain-gno";
import { Blocks, MessagesModule, PackagesModule, ValidatorsModule } from "@eclesia/gno-modules-pg";

const config: PgIndexerConfig<GnoAdapter> = {
  chain: gno(),
  rpcUrl: "http://127.0.0.1:26657",
  usePolling: true,
  pollingInterval: 1000,
  startHeight: 1,
  batchSize: 50,
  modules: [],
  minimal: false,
  processGenesis: true,
  genesisPath: "./genesis.json",
  logLevel: "info",
  dbConnectionString: process.env.PG_CONNECTION_STRING || "postgres://postgres:password@localhost:5432/gno",
};
const indexer = new PgIndexer(config, [new Blocks.FullBlocksModule(), new MessagesModule(), new PackagesModule(), new ValidatorsModule()]);
await indexer.setup();
await indexer.run();
```

## 🔌 Creating Custom Modules

```typescript
export class MyCustomModule implements IndexingModule<CosmosAdapter> {
  name = "my-custom-module";
  depends = ["blocks"];              // Depends on blocks module
  provides = ["custom-data"];        // Provides custom data indexing

  constructor(public indexer: EclesiaIndexer<CosmosAdapter>) {}

  async setup(): Promise<void> {
    // Create database tables, etc.
  }

  init(): void {
    // Register event listeners
    this.indexer.on("tx_events", async (event) => {
      // Process transaction events
    });
  }
}
```

## 🐳 Deployment

The generated projects include Docker support with a preconfigured common use case:

```bash
# Build and run with Docker
docker compose up -d      # Start PostgreSQL, indexer and Hasura instance (credentials are generated into .env at scaffold time)
```

## 📈 Performance

- **Batch Processing**: Prefetch multiple blocks in parallel for optimal throughput
- **WebSocket Support**: Real-time block streaming; any height skipped by the subscription is fetched, and a dead subscription is detected by comparing the chain height every 30 s
- **Transaction Management**: Atomic database operations with automatic rollback
- **Memory Efficient**: Streaming JSON parsing for large datasets
- **Optimized Operations**: High-performance insert and serialization operations
- **Connection Management**: Automatic database connection recycling (every 1500 transactions)
- **Error Recovery**: Restarts with exponential backoff (5 s to 5 min), unlimited unless `maxRetries` is set; an idle chain (halt, upgrade) is reported as `WAITING`, not treated as a failure. A block that fails 5 times in a row after its data was fetched is a bug or bad data, not an outage: the engine emits `fatal-error` and `PgIndexer` exits the process (`exitOnFatal: false` to opt out)
- **Logging**: Structured logs on stdout, text or JSON via `logFormat`; no log files are written
- **LRU Caching**: Memory-efficient caching for validator data
- **Monitoring**: Prometheus metrics and a health endpoint; a Grafana dashboard and the full metric list live in [monitoring/grafana](monitoring/grafana/README.md)

### Benchmarking

Two Vitest bench suites in `packages/chain-cosmos/benchmarks` measure the engine with the Cosmos adapter, with no RPC node and no database:

- **Block processing throughput**: blocks come from the in-memory mock RPC client, transaction handlers are no-ops. Each iteration starts an indexer, processes every block and tears it down, so the numbers cover fetch scheduling, decoding, event dispatch and the start/stop lifecycle.
- **Genesis import**: streams a synthetic 20,000-account genesis file through the same stream-json pipeline the indexer uses at startup, with handlers that only count entries.

```bash
# Run every suite
pnpm run bench

# Run one suite
cd packages/chain-cosmos
pnpm bench block-processing
pnpm bench genesis-parsing
```

Reference results, Apple M4 Pro, 48 GB, Node v24.13.0, 2026-09-09 (mean of 5 iterations):

| Case | Mean | Throughput |
|------|-----:|-----------:|
| 100 blocks, 10 tx each, no listeners | 15 ms | ~6,600 blocks/s |
| 100 blocks, 100 tx each, no listeners | 125 ms | ~800 blocks/s |
| 100 blocks, 10 tx each, 10 message listeners | 14 ms | ~7,100 blocks/s |
| 1,000 blocks, 10 tx each, no listeners | 136 ms | ~7,400 blocks/s |
| 1,000 blocks, 100 tx each, no listeners | 1,659 ms | ~600 blocks/s |
| 1,000 blocks, 100 tx each, 10 message listeners | 1,726 ms | ~580 blocks/s |
| Genesis: 20,000 accounts + 20,000 balances, 2 handlers | 1,106 ms | ~36,000 entries/s |
| Genesis: 20,000 balances, 1 handler | 719 ms | ~28,000 entries/s |

Cost scales with transactions per block rather than block count, and ten no-op listeners add under 10%. Each synthetic transaction carries a bech32 signer address and `coin_spent` / `coin_received` / `transfer` events, and generating that data inside the mock accounts for roughly a quarter of the 100-tx figures. Against a real chain the database and the RPC dominate; these figures are the ceiling the engine itself imposes.

## 🤝 Contributing

This is a monorepo managed with PNPM workspaces:

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint
```

## 📜 License

GNO NETWORK GENERAL PUBLIC LICENSE

## 🆘 Support

- **Issues**: Report bugs and feature requests
- **Documentation**:
  - [Tutorial](TUTORIAL.md) - Getting started guide
  - [Advanced Tutorial](ADVANCED_TUTORIAL.md) - Custom module development
  - [Performance Guide](PERFORMANCE.md) - Production optimization
  - [Troubleshooting](TROUBLESHOOTING.md) - Common issues and solutions
  - [Migration Guide](MIGRATION.md) - Moving a 2.x indexer to 4.0
- **Examples**: See [AtomOne Indexer](https://github.com/allinbits/atomone-indexer)

---

Built with ❤️ for the Cosmos and gno.land ecosystems