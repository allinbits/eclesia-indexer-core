# Benchmarking Guide: Quick Start

This guide shows you how to benchmark the Eclesia indexer engine without needing an RPC node or PostgreSQL database.

## 🚀 Quick Start

```bash
# Run all benchmarks
pnpm run bench

# Run specific benchmark file
pnpm run bench engine-indexing

# Run with filter
pnpm run bench -- -t "Process 100 blocks"
```

## 📊 What Gets Measured

The benchmarking framework isolates and measures:

- **Block Processing Speed**: How fast the engine processes blocks (blocks/sec)
- **Event Emission Overhead**: Cost of the event-driven architecture
- **Transaction Parsing**: Speed of protobuf decoding and event parsing
- **Module Callback Performance**: How fast listeners respond to events

## 🎯 No Dependencies Required

The framework uses **mocks** so you don't need:
- ✅ No RPC node required
- ✅ No PostgreSQL database required
- ✅ No network access required
- ✅ Deterministic and repeatable results

## 💻 Simple Example

```typescript
import { Mocks } from "@eclesia/indexer-engine";
import { bench, describe } from "vitest";
import { createBenchmarkIndexer, processBlockRange } from "./helpers";

describe("My Benchmark", () => {
  bench("Process 100 blocks", async () => {
    // Create indexer with mocked RPC and database
    const { indexer, mockRpc } = createBenchmarkIndexer({
      blockCount: 100,          // Number of blocks to generate
      txsPerBlock: 10,           // Transactions per block
      eventsPerTx: 5,            // Events per transaction
      batchSize: 100,            // Processing batch size  // No-op database
    });

    // Process all blocks
    await processBlockRange(indexer, mockRpc, 1, 100);
  });
});
```

## 📈 Understanding Results

### Output Format

```
name                              hz      min      max     mean      p75      p99
Process 100 blocks (1 tx/block)  45.23   20.12   25.45   22.10    23.01   25.45
Process 100 blocks (10 tx/block) 12.34   78.43   85.12   81.03    82.15   85.12
```

- **hz**: Operations per second (higher is better)
- **mean**: Average time per operation in milliseconds
- **p75/p99**: 75th/99th percentile latency

### Expected Performance

On modern hardware (M1/M2 Mac or equivalent):

| Workload | Blocks/Second | Use Case |
|----------|--------------|----------|
| Light (1 tx/block) | 5,000-10,000 | Testing, validation |
| Medium (10 tx/block) | 1,000-2,000 | Typical blockchain |
| Heavy (50 tx/block) | 200-500 | High-activity chain |

## 🔧 Database Modes

Choose the right mode for your benchmark:

### NOOP (Fastest)
```typescript
dbMode: Mocks.MockDatabaseMode.NOOP
```
- All operations succeed immediately
- No data is stored
- **Use for**: Pure engine performance testing

### IN_MEMORY
```typescript
dbMode: Mocks.MockDatabaseMode.IN_MEMORY
```
- Data stored in memory
- Can query the data
- **Use for**: Correctness testing

### METRICS
```typescript
dbMode: Mocks.MockDatabaseMode.METRICS
```
- Tracks detailed operation metrics
- Slight performance overhead
- **Use for**: Profiling database operations

## 📝 Common Patterns

### Compare Different Workloads

```typescript
const workloads = [
  { name: "Light", txs: 1, events: 3 },
  { name: "Medium", txs: 10, events: 5 },
  { name: "Heavy", txs: 50, events: 10 },
];

workloads.forEach(w => {
  bench(`${w.name} workload`, async () => {
    const { indexer, mockRpc } = createBenchmarkIndexer({
      blockCount: 100,
      txsPerBlock: w.txs,
      eventsPerTx: w.events,
      batchSize: 100,
    });

    await processBlockRange(indexer, mockRpc, 1, 100);
  });
});
```

### Track Database Metrics

```typescript
bench("With database metrics", async () => {
  const { indexer, mockRpc, mockDb } = createBenchmarkIndexer({
    blockCount: 100,
    txsPerBlock: 10,
    eventsPerTx: 5,
    batchSize: 100,
    dbMode: Mocks.MockDatabaseMode.METRICS,
  });

  await processBlockRange(indexer, mockRpc, 1, 100);

  const metrics = mockDb.getMetrics();
  console.log(`Queries: ${metrics.queryCount}`);
  console.log(`Avg time: ${metrics.avgQueryTimeMs}ms`);
});
```

### Test RPC Mock Performance

```typescript
bench("Generate blocks", async () => {
  const mockRpc = Mocks.createMockRpcClient({
    chainId: "test-chain",
    txsPerBlock: 10,
    eventsPerTx: 5,
    latestHeight: 1000,
  });

  for (let i = 1; i <= 1000; i++) {
    await mockRpc.block(i);
  }
});
```

## 🎓 Best Practices

### 1. Use Realistic Workloads

Match your benchmark config to real chain characteristics:

```typescript
// For Cosmos Hub-like chains
{
  txsPerBlock: 10-20,
  eventsPerTx: 5-10,
}

// For high-activity chains
{
  txsPerBlock: 50-100,
  eventsPerTx: 10-20,
}
```

### 2. Warm Up Before Measuring

```typescript
bench("Warmed up benchmark", async () => {
  const { indexer, mockRpc } = createBenchmarkIndexer({...});

  // Warm up: process a few blocks first
  await processBlockRange(indexer, mockRpc, 1, 10);

  // Now measure
  await processBlockRange(indexer, mockRpc, 11, 110);
});
```

### 3. Isolate What You're Testing

```typescript
// Good: Tests only block processing
bench("Block processing only", async () => {
  const { indexer, mockRpc } = createBenchmarkIndexer({
    dbMode: Mocks.MockDatabaseMode.NOOP,  // No DB overhead
  });
  await processBlockRange(indexer, mockRpc, 1, 100);
});

// Good: Tests block processing + database
bench("With database", async () => {
  const { indexer, mockRpc } = createBenchmarkIndexer({
    dbMode: Mocks.MockDatabaseMode.IN_MEMORY,  // Include DB
  });
  await processBlockRange(indexer, mockRpc, 1, 100);
});
```

### 4. Run Multiple Iterations

```bash
# Run with more iterations for stable results
pnpm run bench -- --iterations 100
```

## 🔍 Debugging Performance Issues

### 1. Check Event Listeners

Too many listeners can slow processing:

```typescript
// Count listeners in your module
console.log(`Listeners: ${indexer.listenerCount('block')}`);
```

### 2. Profile Database Operations

Use METRICS mode to find slow queries:

```typescript
const metrics = mockDb.getMetrics();
console.log(metrics.queryTypes);  // See which queries run most
```

### 3. Measure Individual Components

```typescript
bench("Event emission only", async () => {
  const { indexer, mockRpc } = createBenchmarkIndexer({...});

  const block = await mockRpc.block(1);
  const results = await mockRpc.blockResults(1);

  // Measure just event emission
  await indexer.asyncEmit('block', {
    value: { block, block_results: results },
    height: 1,
    timestamp: new Date().toISOString(),
  });
});
```

## 📊 CI/CD Integration

### Save Baseline

```bash
pnpm run bench > benchmarks/baseline.txt
```

### Compare After Changes

```bash
pnpm run bench > benchmarks/current.txt
diff benchmarks/baseline.txt benchmarks/current.txt
```

### Automated Checks

```yaml
# .github/workflows/benchmark.yml
- name: Run benchmarks
  run: pnpm run bench --reporter=json > results.json

- name: Check for regressions
  run: node scripts/check-performance.js
```

## 📚 More Examples

See:
- `benchmarks/example.bench.ts` - Comprehensive examples
- `benchmarks/engine-indexing.bench.ts` - Full engine benchmarks
- `benchmarks/README.md` - Complete documentation

## 🤝 Contributing Benchmarks

When adding benchmarks:

1. **Name clearly**: `"Process 100 blocks (10 tx/block)"`
2. **Document purpose**: Add comment explaining what's being tested
3. **Use consistent configs**: Match existing benchmark patterns
4. **Add expected ranges**: Comment with typical performance

```typescript
// Good benchmark
bench("Process Cosmos Hub workload (10 tx/block)", async () => {
  // Tests realistic Cosmos Hub block processing
  // Expected: 1000-2000 blocks/sec on M1 Mac
  const { indexer, mockRpc } = createBenchmarkIndexer({
    txsPerBlock: 10,
    eventsPerTx: 5,
    // ... rest of config
  });
});
```

## ❓ FAQ

**Q: Why are results different from production?**
A: Benchmarks exclude network and database I/O. They measure pure processing speed.

**Q: Should I use NOOP or IN_MEMORY mode?**
A: NOOP for engine benchmarks, IN_MEMORY for correctness tests.

**Q: How many blocks should I process?**
A: 100-1000 blocks gives stable results. More blocks = longer runtime.

**Q: Can I benchmark my custom modules?**
A: Yes! Register your modules before processing blocks.

**Q: Why do I see "undefined" errors?**
A: Expected when testing internal methods. The benchmarks still run correctly.

## 🎯 Next Steps

1. Run `pnpm run bench` to see current performance
2. Copy `example.bench.ts` as a template
3. Adjust configs to match your use case
4. Compare before/after when making changes

Happy benchmarking! 🚀
