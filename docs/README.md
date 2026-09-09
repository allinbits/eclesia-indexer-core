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

Core indexer engine with block processing, event system, and configuration.

**Key Exports:**
- `EclesiaIndexer` - Main indexer class (`EcleciaIndexer` remains as a deprecated alias until 3.0)
- `IndexerMetrics` - Prometheus metrics
- `Types` - TypeScript type definitions
- `Utils` - Utility functions
- `Validation` - Configuration validation
- `Errors` - Custom error classes
- `CircularBuffer`, `PromiseQueue` - Queue implementations

**Entry Point:** `packages/indexer-engine/src/index.ts`

### @eclesia/basic-pg-indexer

PostgreSQL implementation of the indexer with database transaction management.

**Key Exports:**
- `PgIndexer` - PostgreSQL indexer implementation
- `PgIndexerConfig` - Configuration type

**Entry Point:** `packages/basic-indexer-pg/src/index.ts`

### @eclesia/core-modules-pg

Core Cosmos SDK modules for indexing auth, bank, and staking.

**Key Exports:**
- `AuthModule` - Account management
- `BankModule` - Balance tracking
- `StakingModule` - Validator and delegation tracking
- `FullBlocksModule` - Full block indexing
- `MinimalBlocksModule` - Minimal block indexing

**Entry Point:** `packages/core-modules/src/index.ts`

## Module Interfaces

### IndexingModule

All modules implement this interface:

```typescript
interface IndexingModule {
  indexer: EclesiaIndexer           // Reference to indexer
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

import { Types } from "@eclesia/indexer-engine";
import { loadMigrations, PgIndexer } from "@eclesia/basic-pg-indexer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class CustomModule implements Types.IndexingModule {
  indexer!: Types.EclesiaIndexer;
  private pgIndexer!: PgIndexer;

  name = "custom.module.v1";
  depends = ["cosmos.auth.v1beta1"];
  provides = ["custom.module.v1"];

  async setup() {
    // Schema lives in numbered SQL files (sql/001_initial.sql, sql/002_...) applied once, in order
    await this.pgIndexer.applyMigrations(this.name, loadMigrations(path.join(__dirname, "sql")), "custom_data");
  }

  init(pgIndexer: PgIndexer) {
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
type EclesiaIndexerConfig = {
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
type PgIndexerConfig = {
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

- `block` - New block indexed
- `begin_block` - Begin block events
- `end_block` - End block events
- `tx_events` - Transaction events
- `fatal-error` - Emitted when `maxRetries` is exceeded
- `periodic/small`, `periodic/medium`, `periodic/large` - Every 50, 100 and 1000 blocks
- `genesis/array/<json.path>`, `genesis/value/<json.path>` - Streamed from the genesis file when genesis processing is enabled
- `/<type.url>` (for example `/cosmos.bank.v1beta1.MsgSend`) - One event per message of that type in a successful transaction

Handlers for one event run one after another in registration order, sharing the block's database transaction; the first failure stops the rest and rolls the block back. Every event handler is typed through the global `EventMap`. The engine and `@eclesia/core-modules-pg` ship their augmentations, so core events are typed out of the box; custom modules add theirs with `declare global { interface EventMap extends MyEvents {} }`.

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
