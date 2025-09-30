# Eclesia Indexer Core

A powerful, modular framework for indexing Cosmos SDK blockchain data. Eclesia Indexer provides the tools to efficiently collect, process, and store blockchain data from any Cosmos-based chain.

## 🚀 Quick Start

```bash
# Create a new indexer project
npx create-eclesia-indexer@latest

# Configure your chain and follow the instructions to build a postgres-based indexer
```

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
  indexer: EcleciaIndexer           // Reference to main indexer
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
- Database schema management
- Optimized for high-throughput indexing

### 🧩 Core Modules (`@eclesia/core-modules-pg`)

Pre-built indexing modules for common Cosmos SDK functionality.

**Available Modules:**
- **`Blocks`**: Blocks.Full :Block and transaction indexing or Blocks.Minimal: Height tracking 
- **`AuthModule`**: Account authentication data
- **`BankModule`**: Token transfers and balances
- **`StakingModule`**: Validator and delegation data

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

The indexer is configured through the `EcleciaIndexerConfig` (or `PgIndexerConfig` for PostgreSQL) interface:

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
import { EcleciaIndexer, EcleciaIndexerConfig } from '@eclesia/indexer-engine';

const config: EcleciaIndexerConfig = {
  // Custom configuration
};

const indexer = new EcleciaIndexer(config);
// Custom event handlers and modules
await indexer.setup();
await indexer.run();
```

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

  constructor(public indexer: EcleciaIndexer) {}

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
docker-compose up -d      # Start PostgreSQL, indexer and Hasura instance
```

## 📈 Performance

- **Batch Processing**: Prefetch multiple blocks in parallel
- **WebSocket Support**: Real-time block streaming
- **Transaction Management**: Atomic database operations
- **Memory Efficient**: Streaming JSON parsing for large datasets

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
- **Extended Documentation**: [Coming soon]
- **Examples**: See [AtomOne Indexer](https://github.com/allinbits/atomone-indexer)

---

Built with ❤️ for the Cosmos ecosystem