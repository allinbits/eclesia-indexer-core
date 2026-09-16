# API Documentation

This directory contains API reference documentation for the Eclesia Indexer Core packages.

## Generating Documentation

The project uses TypeDoc to generate API documentation from TypeScript source code.

### Generate Documentation

```bash
pnpm typedoc
```

This will generate HTML documentation in `docs/api/` directory.

### View Documentation

After generation:
```bash
# Serve locally
cd docs/api
python3 -m http.server 8000

# Open in browser
open http://localhost:8000
```

## Package Documentation

### @eclesia/indexer-engine

Chain-agnostic indexer engine: block pipeline, event system, recovery, configuration, and the `ChainAdapter` contract.

**Key Exports:**
- `EclesiaIndexer<A>` - Main indexer class, generic over the chain adapter
- `ChainAdapter`, `FetchedBlock`, `ProcessContext`, `GenesisContext` - The adapter contract
- `Mocks.syntheticChain`, `Mocks.adapterContractCases` - Test helpers for engine and adapter authors
- `IndexerMetrics` - Prometheus metrics
- `Types` - TypeScript type definitions
- `Utils` - Utility functions
- `Validation` - Configuration validation
- `Errors` - Custom error classes
- `CircularBuffer`, `PromiseQueue` - Queue implementations

**Entry Point:** `packages/indexer-engine/src/index.ts`

### @eclesia/chain-cosmos

Cosmos SDK / CometBFT adapter on cosmjs.

**Key Exports:**
- `cosmos(options?)`, `CosmosAdapter` - The adapter; `connect` option for custom or mock clients
- `CosmosEvents`, `TxResult`, `CosmosBlock` - Event and payload types
- `Mocks.createMockRpcClient` - Synthetic CometBFT node

**Entry Point:** `packages/chain-cosmos/src/index.ts`

### @eclesia/chain-gno

gno.land / Tendermint2 adapter on tm2-rpc and gno-types.

**Key Exports:**
- `gno(options?)`, `GnoAdapter` - The adapter; `connect` and `decoders` options
- `GnoEvents`, `GnoTx`, `GnoMsgEvent`, `MsgSend`, `MsgCall`, `MsgAddPackage`, `MsgRun` - Event and message types
- `parseGenesisBalance`, `decodeTx`, `messageDecoders` - Helpers
- `Mocks.createMockTm2Client` - Synthetic Tendermint2 node

**Entry Point:** `packages/chain-gno/src/index.ts`

### @eclesia/basic-pg-indexer

PostgreSQL implementation of the indexer with database transaction management.

**Key Exports:**
- `PgIndexer<A>` - PostgreSQL indexer implementation, generic over the chain adapter
- `PgIndexerConfig<A>` - Configuration type

**Entry Point:** `packages/basic-indexer-pg/src/index.ts`

### @eclesia/cosmos-modules-pg

Cosmos SDK modules for indexing blocks, auth, bank, and staking (formerly `@eclesia/core-modules-pg`).

**Key Exports:**
- `AuthModule` - Account management
- `BankModule` - Balance tracking
- `StakingModule` - Validator and delegation tracking
- `Blocks.FullBlocksModule` - Full block indexing
- `Blocks.MinimalBlocksModule` - Minimal block indexing

**Entry Point:** `packages/cosmos-modules/src/index.ts`

### @eclesia/gno-modules-pg

gno.land modules.

**Key Exports:**
- `Blocks.FullBlocksModule`, `Blocks.MinimalBlocksModule` - Blocks, transactions with decoded messages, block-time averages
- `MessagesModule` - `bank_sends`, `vm_calls`, `vm_add_packages`, `vm_runs`, `gno_events`
- `PackagesModule` - `packages` and `package_files`, from deployments and genesis
- `ValidatorsModule` - `validators` and `validator_power_history` (full mode)

**Entry Point:** `packages/gno-modules/src/index.ts`

## Module Interfaces

### IndexingModule

All modules implement this interface:

```typescript
interface IndexingModule<A extends ChainAdapter> {
  indexer: EclesiaIndexer<A>        // Reference to indexer
  name: string                       // Unique module identifier
  depends: string[]                  // Module dependencies
  provides: string[]                 // Capabilities provided
  setup: () => Promise<void>         // Schema initialization
  init: (...args: any[]) => void    // Module initialization
}
```

### Example Module Implementation

```typescript
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { loadMigrations, PgIndexer } from "@eclesia/basic-pg-indexer";
import { CosmosAdapter } from "@eclesia/chain-cosmos";
import { EclesiaIndexer, Types } from "@eclesia/indexer-engine";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class CustomModule implements Types.IndexingModule<CosmosAdapter> {
  indexer!: EclesiaIndexer<CosmosAdapter>;
  private pgIndexer!: PgIndexer<CosmosAdapter>;

  name = "custom.module.v1";
  depends = ["cosmos.auth.v1beta1"];
  provides = ["custom.module.v1"];

  async setup() {
    // Schema lives in numbered SQL files (sql/001_initial.sql, sql/002_...) applied once, in order
    await this.pgIndexer.applyMigrations(this.name, loadMigrations(path.join(__dirname, "sql")), "custom_data");
  }

  init(pgIndexer: PgIndexer<CosmosAdapter>) {
    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;

    // Register event handlers
    this.indexer.on("block", async (event) => {
      // Process block
    });
  }
}
```

## Type Definitions

### EclesiaIndexerConfig

```typescript
type EclesiaIndexerConfig<A extends ChainAdapter> = {
  chain: A                          // cosmos() or gno()
  startHeight?: number
  endHeight?: number
  batchSize: number
  modules: string[]
  getNextHeight: () => number | PromiseLike<number>
  logLevel: "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly"
  rpcUrl: string
  chainId?: string                  // refuse to index if the RPC reports another network
  shouldProcessGenesis: () => Promise<boolean>
  genesisPath?: string
  usePolling?: boolean
  pollingInterval?: number
  minimal?: boolean
  enableHealthcheck?: boolean       // default true
  healthCheckPort?: number          // default 8888
  healthCheckHost?: string          // default "0.0.0.0"
  enablePrometheus?: boolean
  prometheusPort?: number           // default 9090
  prometheusHost?: string           // default "0.0.0.0"
  logFormat?: "text" | "json"       // console output format, default "text"
  maxRetries?: number               // consecutive failed restarts before fatal-error; unlimited when unset
  maxFailuresPerBlock?: number      // consecutive failures of one block before fatal-error; default 5
  onGenesisStart?: () => Promise<void>     // storage hook, before the genesis import writes anything
  onGenesisComplete?: () => Promise<void>  // storage hook, inside the final genesis transaction
  init?: () => Promise<void>
  beginTransaction: () => Promise<void>
  endTransaction: (status: boolean) => Promise<void>
}
```

### PgIndexerConfig

```typescript
type PgIndexerConfig<A extends ChainAdapter> = {
  chain: A                          // cosmos() or gno()
  startHeight?: number              // used only when the database holds no blocks yet
  batchSize: number
  modules: string[]
  rpcUrl: string
  logLevel: "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly"
  usePolling?: boolean
  processGenesis?: boolean
  pollingInterval?: number
  minimal?: boolean
  genesisPath?: string
  dbConnectionString: string
  synchronousCommit?: boolean       // keep PostgreSQL synchronous_commit on; default false
  exitOnFatal?: boolean             // exit the process after fatal-error; default true
  // plus every EclesiaIndexerConfig option above except the transaction callbacks
}
```

### PgIndexer API

| Method | Purpose |
|--------|---------|
| `setup()` | Connects to the RPC and runs every module's `setup()` (schema migrations) |
| `run()` | Connects and starts indexing; resolves when the indexer stops |
| `stop()` | Stops the engine, closes the RPC clients and HTTP servers, and ends the database connection |
| `applyMigrations(module, migrations, baselineTable)` | Applies a module's pending numbered migrations, each in its own transaction, recording them in `schema_migrations`; legacy databases are baselined at version 1 |
| `getInstance()` | The current `pg.Client` for module queries |
| `beginTransaction()` / `endTransaction(commit)` | Transaction control used by the engine around each block |

`loadMigrations(dir)` reads `NNN_name.sql` files from a directory into the `Migration[]` that `applyMigrations` expects.

## Event System

The indexer uses an event-driven architecture. Modules can listen to events:

### Core Events

Block-level events are declared by the chain adapter:

- Cosmos: `block`, `begin_block`, `end_block`, `tx_events`, `tx_memo`, and `/<type.url>` per message
- gno: `block`, `begin_block`, `end_block`, `tx`, and `/bank.MsgSend`, `/vm.m_call`, `/vm.m_addpkg`, `/vm.m_run` per message

Engine events, for every chain:

- `fatal-error` - Emitted when `maxRetries` is exceeded or one block keeps failing
- `periodic/small`, `periodic/medium`, `periodic/large` - Every 50, 100 and 1000 blocks
- `genesis/array/<json.path>`, `genesis/value/<json.path>` - Streamed from the genesis file when genesis processing is enabled
- `/<type.url>` (for example `/cosmos.bank.v1beta1.MsgSend`) - One event per message of that type in a successful transaction

Handlers for one event run one after another in registration order, sharing the block's database transaction; the first failure stops the rest and rolls the block back. Every event handler is typed through the global `EventMap`. The engine, the chain adapter and the module packages ship their augmentations, so core events are typed out of the box; custom modules add theirs with `declare global { interface EventMap extends MyEvents {} }`. Use one chain adapter package per TypeScript project.

### Custom Events

Modules can emit custom events:

```typescript
this.indexer.asyncEmit("custom/event", {
  value: data,
  height: blockHeight,
  timestamp: blockTime
});
```

## Utilities

### Address Conversion

```typescript
import { Utils } from "@eclesia/indexer-engine";

// Convert key hash to bech32 address
const address = Utils.chainAddressfromKeyhash("cosmos", keyhash);
```

### BigInt Handling

```typescript
import { Utils } from "@eclesia/indexer-engine";

// Convert BigInt to plain object for JSON
const plainObj = Utils.toPlainObject(dataWithBigInt);
```

### Validation

```typescript
import { Validation } from "@eclesia/indexer-engine";

// Validate URL
Validation.validateUrl(rpcUrl);

// Validate file path
Validation.validateFilePath(genesisPath);

// Validate database connection
Validation.validatePostgresConnectionString(connString);
```

## Metrics

### Using IndexerMetrics

```typescript
import { IndexerMetrics } from "@eclesia/indexer-engine";

const metrics = new IndexerMetrics();

// Update metrics
metrics.updateBlockMetrics(currentHeight, latestHeight, queueSize);
metrics.recordError("rpc");

// Expose metrics
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", metrics.registry.contentType);
  res.end(await metrics.getMetrics());
});
```

## Further Reading

- [Troubleshooting Guide](../TROUBLESHOOTING.md)
- [Performance Guide](../PERFORMANCE.md)
- Package README files in each package directory

## Contributing

When adding new public APIs:
1. Add JSDoc comments
2. Export from package index
3. Update this documentation
4. Run `pnpm typedoc` to regenerate
