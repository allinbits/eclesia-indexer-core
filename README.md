# Eclesia Indexer Core

A powerful, modular framework for indexing Cosmos SDK blockchain data. Eclesia Indexer provides the tools to efficiently collect, process, and store blockchain data from any Cosmos-based chain.

## Key Features

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

Eclesia is built as a monorepo with four core packages that work together:

```
┌─────────────────────┐    ┌──────────────────────┐
│ create-eclesia-     │    │ @eclesia/            │
│ indexer             │───▶│ indexer-engine       │
│ (CLI scaffolding)   │    │ (Core engine)        │
└─────────────────────┘    └──────────┬───────────┘
                                      │
                          ┌───────────▼───────────┐
                          │ @eclesia/             │
                          │ basic-pg-indexer      │
                          │ (PostgreSQL impl)     │
                          └───────────┬───────────┘
                                      │
                          ┌───────────▼───────────┐
                          │ @eclesia/             │
                          │ core-modules-pg       │
                          │ (Pre-built modules)   │
                          └───────────────────────┘
```

### Package Responsibilities

| Package | Purpose | Usage |
|---------|---------|-------|
| **`@eclesia/indexer-engine`** | Core indexing engine that processes blocks and emits events | Foundation for all indexers |
| **`@eclesia/basic-pg-indexer`** | PostgreSQL implementation of the indexer engine | Most common use case |
| **`@eclesia/core-modules-pg`** | Pre-built modules for common Cosmos SDK features | Ready-to-use indexing modules |
| **`create-eclesia-indexer`** | CLI tool for scaffolding new indexer projects | Getting started quickly |

## 🏗️ Core Concepts

### Event-Driven Architecture

Eclesia processes blockchain data by iterating through blocks and emitting events for different types of data:

- **Block Events**: `begin_block`, `block`, `end_block`
- **Transaction Events**: `tx_events`, `tx_memo`
- **Validator Events**: Validator set changes and staking data
- **Custom Events**: Chain-specific events from messages and state changes

### Modular Design

Create custom modules for the basic PG indexer by implementing the `IndexingModule` interface:

```typescript
interface IndexingModule {
  indexer: EclesiaIndexer           // Reference to main indexer
  name: string                      // Unique module name
  depends: string[]                 // Dependencies on other modules
  provides: string[]                // Capabilities this module provides
  setup: () => Promise<void>        // Database schema setup
  init: (...args: any[]) => void   // Event listener registration
}
```

## 📋 Packages

### 🔧 Core Engine (`@eclesia/indexer-engine`)

The foundational package that provides the core indexing functionality.

**Key Features:**
- Block processing and event emission
- WebSocket and polling support for real-time indexing
- Configurable batch processing
- Genesis state processing
- Transaction management

### 🐘 PostgreSQL Indexer (`@eclesia/basic-pg-indexer`)

A PostgreSQL-specific implementation of the indexer engine, perfect for most use cases.

**Key Features:**
- Built-in PostgreSQL connection management
- Transaction support with rollback capabilities
- Versioned schema migrations, applied on start and tracked per module
- Optimized for high-throughput indexing

### 🧩 Core Modules (`@eclesia/core-modules-pg`)

Pre-built indexing modules for common Cosmos SDK functionality.

**Available Modules:**
- **`Blocks`**: Blocks.Full :Block and transaction indexing or Blocks.Minimal: Height tracking 
- **`AuthModule`**: Account authentication data
- **`BankModule`**: Token transfers and balances
- **`StakingModule`**: Validator and delegation data. Requires `Blocks.FullBlocksModule` (its schema references the block proposer) and a genesis import from height 1, so every proposer is known

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
const config: PgIndexerConfig = {
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
  minimal: false,                    // Minimal mode (blocks only)
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
import { EclesiaIndexer, EclesiaIndexerConfig } from '@eclesia/indexer-engine';

const config: EclesiaIndexerConfig = {
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
  AuthModule, BankModule, Blocks, StakingModule,
} from "@eclesia/core-modules-pg";

import {
  GovModule,
} from "./modules/atomone.gov.v1beta1/index.js";

const config: PgIndexerConfig = {
  startHeight: 1,
  batchSize: Number(process.env.QUEUE_SIZE) || 300,
  modules: [],
  rpcUrl: process.env.RPC_ENDPOINT || "https://rpc.atomone.network",
  logLevel: process.env.LOG_LEVEL as PgIndexerConfig["logLevel"] ?? "info",
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

## 🔌 Creating Custom Modules

```typescript
export class MyCustomModule implements IndexingModule {
  name = "my-custom-module";
  depends = ["blocks"];              // Depends on blocks module
  provides = ["custom-data"];        // Provides custom data indexing

  constructor(public indexer: EclesiaIndexer) {}

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

Two Vitest bench suites in `packages/indexer-engine/benchmarks` measure the engine on its own, with no RPC node and no database:

- **Block processing throughput**: blocks come from the in-memory mock RPC client, transaction handlers are no-ops. Each iteration starts an indexer, processes every block and tears it down, so the numbers cover fetch scheduling, decoding, event dispatch and the start/stop lifecycle.
- **Genesis import**: streams a synthetic 20,000-account genesis file through the same stream-json pipeline the indexer uses at startup, with handlers that only count entries.

```bash
# Run every suite
pnpm run bench

# Run one suite
cd packages/indexer-engine
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
- **Examples**: See [AtomOne Indexer](https://github.com/allinbits/atomone-indexer)

---

Built with ❤️ for the Cosmos ecosystem