# Eclesia Indexer Benchmarking Framework

This directory contains a comprehensive benchmarking framework for testing the performance of the Eclesia indexer engine without requiring access to a live RPC node or PostgreSQL database.

## Overview

The benchmarking framework provides:

- **Mock RPC Client**: Generates synthetic blockchain data (blocks, transactions, events)
- **Mock Database**: Provides no-op or in-memory database operations
- **Benchmark Suites**: Comprehensive tests for different aspects of the indexer
- **Helper Utilities**: Easy configuration and setup for benchmarks

## Architecture

```
┌─────────────────────────────────────────────────┐
│           Benchmark Suite                       │
│  (engine-indexing.bench.ts)                     │
└──────────────────┬──────────────────────────────┘
                   │
       ┌───────────▼───────────┐
       │   EcleciaIndexer      │
       │   (Core Engine)       │
       └───┬─────────────┬─────┘
           │             │
   ┌───────▼─────┐   ┌──▼──────────┐
   │  Mock RPC   │   │  Mock DB    │
   │  Client     │   │  Client     │
   └─────────────┘   └─────────────┘
```

## Mock Components

### Mock RPC Client

Located in: `packages/indexer-engine/src/mocks/rpc-client.ts`

Generates synthetic blockchain data without network I/O:

```typescript
import { Mocks } from "@eclesia/indexer-engine";

const mockRpc = Mocks.createMockRpcClient({
  chainId: "benchmark-chain",
  txsPerBlock: 10,           // Transactions per block
  eventsPerTx: 5,            // Events per transaction
  startHeight: 1,
  latestHeight: 1000,
  blockTimeMs: 6000,         // 6 second block time
});

// Use like a real CometClient
const block = await mockRpc.block(100);
const results = await mockRpc.blockResults(100);
const status = await mockRpc.status();
```

**Features:**
- Generates realistic block structures with headers, transactions, and signatures
- Configurable transaction and event counts
- Deterministic and repeatable data generation
- No network latency

### Mock Database Client

Located in: `packages/indexer-engine/src/mocks/database.ts`

Provides database operations without PostgreSQL:

```typescript
import { Mocks } from "@eclesia/indexer-engine";

const mockDb = Mocks.createMockDatabase({
  mode: Mocks.MockDatabaseMode.NOOP,  // or IN_MEMORY, METRICS
  trackMetrics: true,
  queryLatencyMs: 0,         // Optional simulated latency
});

// Use like a PostgreSQL client
await mockDb.query("BEGIN");
await mockDb.query("INSERT INTO blocks (height) VALUES ($1)", [100]);
await mockDb.query("COMMIT");

// Get metrics
const metrics = mockDb.getMetrics();
console.log(`Queries executed: ${metrics.queryCount}`);
console.log(`Avg query time: ${metrics.avgQueryTimeMs}ms`);
```

**Modes:**

- `NOOP`: All operations succeed immediately without storing data (fastest)
- `IN_MEMORY`: Stores data in memory for verification (useful for correctness tests)
- `METRICS`: Tracks detailed operation metrics (useful for profiling)

## Running Benchmarks

### Run All Benchmarks

```bash
pnpm run bench
```

### Run Specific Benchmark Suite

```bash
pnpm run bench engine-indexing
```

### Run with Filtering

```bash
# Run only "Process 100 blocks" benchmarks
pnpm run bench -- -t "Process 100 blocks"
```

### Run with Output

```bash
# Save results to file
pnpm run bench > benchmark-results.txt
```

## Benchmark Suites

### 1. Engine Block Processing (`engine-indexing.bench.ts`)

Tests the core indexer's ability to process blocks with different workloads:

- **Light workload**: 1 tx/block, 3 events/tx
- **Medium workload**: 10 tx/block, 5 events/tx
- **Heavy workload**: 50 tx/block, 5 events/tx

**What it measures:**
- Block deserialization
- Transaction parsing
- Event emission
- Module callback performance

### 2. Event Emission Performance

Tests the event-driven architecture:

- No listeners (baseline)
- Single listener
- Multiple listeners (5+)

**What it measures:**
- Event routing overhead
- UUID tracking for async events
- Listener callback execution

### 3. Transaction Parsing Performance

Tests transaction and event parsing:

- Basic transactions
- Transactions with many events
- Bulk parsing operations

**What it measures:**
- Protobuf decoding
- Event attribute parsing
- JSON log parsing

### 4. Database Operation Performance

Tests database mock performance:

- No-op queries
- In-memory queries
- Transaction operations

**What it measures:**
- Query execution overhead
- Transaction management
- Metrics tracking overhead

### 5. RPC Mock Performance

Tests the mock RPC client:

- Block generation
- Block results generation
- High-transaction blocks

**What it measures:**
- Synthetic data generation speed
- Memory allocation patterns

## Creating Custom Benchmarks

### Basic Example

```typescript
import { Mocks } from "@eclesia/indexer-engine";
import { bench, describe } from "vitest";
import { createBenchmarkIndexer, processBlockRange } from "./helpers";

describe("My Custom Benchmark", () => {
  bench("Process 50 blocks with custom config", async () => {
    const { indexer, mockRpc } = createBenchmarkIndexer({
      blockCount: 50,
      txsPerBlock: 20,
      eventsPerTx: 10,
      batchSize: 50,
    });

    await processBlockRange(indexer, mockRpc, 1, 50);
  });
});
```

### Advanced Example with Metrics

```typescript
import { Mocks } from "@eclesia/indexer-engine";
import { bench, describe } from "vitest";
import { createBenchmarkIndexer, getDbMetrics } from "./helpers";

describe("Benchmark with Metrics", () => {
  bench("Process blocks and measure DB operations", async () => {
    const { indexer, mockRpc, mockDb } = createBenchmarkIndexer({
      blockCount: 100,
      txsPerBlock: 10,
      eventsPerTx: 5,
      batchSize: 100,
      dbMode: Mocks.MockDatabaseMode.METRICS,
    });

    // Process blocks
    for (let h = 1; h <= 100; h++) {
      const block = await mockRpc.block(h);
      const results = await mockRpc.blockResults(h);
      await (indexer as any).processBlock(block, results);
    }

    // Analyze metrics
    const metrics = getDbMetrics(mockDb);
    console.log(`Total queries: ${metrics.queryCount}`);
    console.log(`Transactions committed: ${metrics.transactions.committed}`);
  });
});
```

## Helper Utilities

### `createBenchmarkIndexer(config)`

Creates a fully configured indexer with mocked dependencies:

```typescript
const { indexer, mockRpc, mockDb } = createBenchmarkIndexer({
  blockCount: 100,        // Number of blocks to simulate
  txsPerBlock: 10,        // Transactions per block
  eventsPerTx: 5,         // Events per transaction
  batchSize: 100,         // Processing batch size
  dbMode: Mocks.MockDatabaseMode.NOOP,
  chainId: "my-chain",    // Optional chain ID
});
```

### `processBlockRange(indexer, mockRpc, start, end)`

Process a range of blocks and measure performance:

```typescript
const result = await processBlockRange(indexer, mockRpc, 1, 100);
console.log(`Duration: ${result.duration}ms`);
console.log(`Rate: ${result.blocksPerSecond} blocks/sec`);
```

### `getDbMetrics(mockDb)`

Get detailed database operation metrics:

```typescript
const metrics = getDbMetrics(mockDb);
console.log(metrics.queryCount);           // Total queries
console.log(metrics.avgQueryTimeMs);       // Average query time
console.log(metrics.queryTypes);           // Breakdown by query type
console.log(metrics.transactions.begun);   // Transactions begun
console.log(metrics.transactions.committed); // Transactions committed
```

## Interpreting Results

### Baseline Performance

On a modern machine (M1/M2 Mac or equivalent):

- **Light workload**: ~5,000-10,000 blocks/sec
- **Medium workload**: ~1,000-2,000 blocks/sec
- **Heavy workload**: ~200-500 blocks/sec

These numbers represent pure processing speed without network or database I/O.

### What Affects Performance

1. **Transactions per block**: More transactions = more parsing work
2. **Events per transaction**: More events = more event emission overhead
3. **Module listeners**: More listeners = more callback overhead
4. **Database mode**: IN_MEMORY > NOOP (slightly), METRICS has overhead
5. **Event complexity**: Complex event structures take longer to parse

### Optimization Tips

If benchmarks show poor performance:

1. **Check event listeners**: Too many listeners can slow processing
2. **Profile event emission**: Use METRICS mode to identify bottlenecks
3. **Batch operations**: Ensure database operations are batched properly
4. **Review parsing logic**: Complex parsing in modules can be slow
5. **Memory allocation**: Check for unnecessary object creation

## Use Cases

### 1. Development Performance Testing

Test changes without running a full node:

```bash
# Before making changes
pnpm run bench > before.txt

# Make your changes...

# After making changes
pnpm run bench > after.txt

# Compare
diff before.txt after.txt
```

### 2. CI/CD Performance Regression Testing

Add to your CI pipeline:

```yaml
- name: Run benchmarks
  run: pnpm run bench --reporter=json > bench-results.json

- name: Compare with baseline
  run: node scripts/compare-benchmarks.js
```

### 3. Profiling and Optimization

Identify bottlenecks:

```typescript
bench("Profile event processing", async () => {
  const { indexer, mockRpc, mockDb } = createBenchmarkIndexer({
    blockCount: 10,
    txsPerBlock: 100,
    eventsPerTx: 20,
    batchSize: 10,
    dbMode: Mocks.MockDatabaseMode.METRICS,
  });

  // Enable profiling
  console.profile("Block Processing");

  for (let h = 1; h <= 10; h++) {
    const block = await mockRpc.block(h);
    const results = await mockRpc.blockResults(h);
    await (indexer as any).processBlock(block, results);
  }

  console.profileEnd("Block Processing");

  // Analyze metrics
  const metrics = getDbMetrics(mockDb);
  console.log("DB Operations:", metrics.queryCount);
});
```

### 4. Load Testing

Simulate high-throughput scenarios:

```typescript
bench("High throughput - 10,000 blocks", async () => {
  const { indexer, mockRpc } = createBenchmarkIndexer({
    blockCount: 10000,
    txsPerBlock: 50,
    eventsPerTx: 10,
    batchSize: 500,
    dbMode: Mocks.MockDatabaseMode.NOOP,
  });

  await processBlockRange(indexer, mockRpc, 1, 10000);
}, { time: 60000 }); // 60 second timeout
```

## Integration with Real Components

You can also benchmark against real RPC/DB for comparison:

```typescript
describe("Real vs Mock Comparison", () => {
  bench("Mock RPC", async () => {
    const mockRpc = Mocks.createMockRpcClient({
      latestHeight: 100,
      txsPerBlock: 10,
    });

    for (let i = 1; i <= 100; i++) {
      await mockRpc.block(i);
    }
  });

  bench("Real RPC (if available)", async () => {
    // Only run if RPC_URL is set
    if (!process.env.RPC_URL) return;

    const client = await connectComet(process.env.RPC_URL);
    const status = await client.status();
    const latest = status.syncInfo.latestBlockHeight;

    for (let i = latest - 99; i <= latest; i++) {
      await client.block(i);
    }
  });
});
```

## Troubleshooting

### Benchmarks are slow

- Check if you're running in debug mode
- Ensure `logLevel` is set to `"error"` in configs
- Use `NOOP` mode for pure engine benchmarks
- Reduce block count or transaction count

### Out of memory errors

- Reduce `batchSize` in configuration
- Process fewer blocks at once
- Clear mock database between runs: `mockDb.clearStore()`

### Inconsistent results

- Run benchmarks multiple times: `pnpm run bench --iterations 10`
- Close other applications
- Use a consistent machine/environment
- Check for background processes

## Contributing

When adding new benchmarks:

1. Use descriptive names that explain what's being measured
2. Document what the benchmark tests
3. Use consistent configuration across related benchmarks
4. Add comments explaining non-obvious setup
5. Include expected performance ranges in comments

## Further Reading

- [Vitest Benchmark Documentation](https://vitest.dev/guide/features.html#benchmarking)
- [Core Engine Documentation](../packages/indexer-engine/README.md)
- [Creating Custom Modules](../TUTORIAL.md)
