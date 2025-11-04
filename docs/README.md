# API Documentation

This directory contains API reference documentation for the Eclesia Indexer Core packages.

## Generating Documentation

The project uses TypeDoc to generate API documentation from TypeScript source code.

### Generate Documentation

```bash
pnpm docs
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
- `EcleciaIndexer` - Main indexer class
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
  indexer: EcleciaIndexer           // Reference to indexer
  name: string                       // Unique module identifier
  depends: string[]                  // Module dependencies
  provides: string[]                 // Capabilities provided
  setup: () => Promise<void>         // Schema initialization
  init: (...args: any[]) => void    // Module initialization
}
```

### Example Module Implementation

```typescript
import { Types } from "@eclesia/indexer-engine";
import { PgIndexer } from "@eclesia/basic-pg-indexer";

export class CustomModule implements Types.IndexingModule {
  indexer!: Types.EcleciaIndexer;
  private pgIndexer!: PgIndexer;

  name = "custom.module.v1";
  depends = ["cosmos.auth.v1beta1"];
  provides = ["custom.module.v1"];

  async setup() {
    // Initialize database schema
    const db = this.pgIndexer.getInstance();
    await db.query("CREATE TABLE IF NOT EXISTS custom_data (...)");
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

### EcleciaIndexerConfig

```typescript
type EcleciaIndexerConfig = {
  startHeight?: number
  endHeight?: number
  batchSize: number
  modules: string[]
  getNextHeight: () => number | PromiseLike<number>
  logLevel: "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly"
  rpcUrl: string
  shouldProcessGenesis: () => Promise<boolean>
  genesisPath?: string
  usePolling?: boolean
  pollingInterval?: number
  minimal?: boolean
  healthCheckPort?: number
  init?: () => Promise<void>
  beginTransaction: () => Promise<void>
  endTransaction: (status: boolean) => Promise<void>
}
```

### PgIndexerConfig

```typescript
type PgIndexerConfig = {
  startHeight: number
  batchSize: number
  modules: string[]
  rpcUrl: string
  logLevel: "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly"
  usePolling: boolean
  processGenesis?: boolean
  pollingInterval: number
  minimal: boolean
  genesisPath?: string
  dbConnectionString: string
}
```

## Event System

The indexer uses an event-driven architecture. Modules can listen to events:

### Core Events

- `block` - New block indexed
- `begin_block` - Begin block events
- `end_block` - End block events
- `tx_events` - Transaction events
- `fatal-error` - Fatal error occurred
- `periodic/50`, `periodic/100`, `periodic/1000` - Periodic events

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
- [Security Considerations](../SECURITY.md)
- Package README files in each package directory

## Contributing

When adding new public APIs:
1. Add JSDoc comments
2. Export from package index
3. Update this documentation
4. Run `pnpm docs` to regenerate
