# Performance Tuning Guide

This guide provides recommendations for optimizing Eclesia Indexer performance in production environments.

## Configuration Tuning

### Batch Size

The `batchSize` parameter controls how many blocks are prefetched and processed in parallel.

**Default:** 500 blocks

**Tuning Guidelines:**
- **Low-power systems**: 100-300 blocks
- **Standard servers**: 300-700 blocks
- **High-performance systems**: 700-1000 blocks
- **Very large blocks**: Reduce to 100-300

**Impact:**
- Higher = More memory usage, better throughput
- Lower = Less memory, slower throughput

**Example:**
```typescript
{
  batchSize: 700  // Optimize for throughput
}
```

**Monitoring:**
```bash
# Watch memory usage
curl http://localhost:9090/metrics | grep nodejs_heap

# Monitor queue depth
curl http://localhost:9090/metrics | grep indexer_queue_depth
```

### Polling vs WebSocket

**WebSocket (default):**
- Real-time block notifications
- Lower latency
- More efficient for live chains

**Polling:**
- More reliable for unstable connections
- Easier to debug
- Use when WebSocket unavailable

**Configuration:**
```typescript
{
  usePolling: false,  // Use WebSocket (recommended)
  pollingInterval: 5000  // Only used if usePolling=true
}
```

**When to use polling:**
- RPC behind load balancer with session issues
- Frequent WebSocket disconnections
- Debugging connection problems

### Minimal vs Full Indexing

**Minimal Mode** (blocks only):
- Faster indexing
- Lower RPC load
- No validator data required
- Use when full data not needed

**Full Mode** (complete data):
- Includes validator information
- Requires additional RPC calls
- Necessary for staking modules

**Configuration:**
```typescript
{
  minimal: true  // Enable minimal mode
}
```

**Performance difference:** Minimal mode is ~30-40% faster

## Database Optimization

### Essential Indexes

Create these indexes for optimal performance:

```sql
-- Blocks table
CREATE INDEX idx_blocks_height ON blocks(height);
CREATE INDEX idx_blocks_time ON blocks(time);

-- Balances table
CREATE INDEX idx_balances_address ON balances(address);
CREATE INDEX idx_balances_height ON balances(height);
CREATE INDEX idx_balances_address_height ON balances(address, height);

-- Validators table
CREATE INDEX idx_validators_consensus ON validators(consensus_address);

-- Validator infos table
CREATE INDEX idx_validator_infos_operator ON validator_infos(operator_address);
CREATE INDEX idx_validator_infos_height ON validator_infos(height);

-- Staked balances table
CREATE INDEX idx_staked_delegator ON staked_balances(delegator);
CREATE INDEX idx_staked_validator ON staked_balances(validator);
CREATE INDEX idx_staked_delegator_validator ON staked_balances(delegator, validator);
```

### PostgreSQL Configuration

Recommended settings for indexing workload in `postgresql.conf`:

```ini
# Memory Settings
shared_buffers = 4GB          # 25% of total RAM
effective_cache_size = 12GB    # 50-75% of total RAM
work_mem = 64MB               # For sorting/aggregation
maintenance_work_mem = 1GB    # For VACUUM, CREATE INDEX

# WAL Settings (Write-Ahead Log)
wal_buffers = 16MB
checkpoint_completion_target = 0.9
max_wal_size = 4GB
min_wal_size = 1GB

# Query Planner
random_page_cost = 1.1        # For SSD storage
effective_io_concurrency = 200 # For SSD

# Connection Settings
max_connections = 100

# Autovacuum (important for write-heavy workload)
autovacuum = on
autovacuum_max_workers = 4
autovacuum_naptime = 10s
```

**Note:** Adjust based on your hardware. The above assumes 16GB RAM, SSD storage.

### Connection Pooling

The indexer includes automatic connection recycling:

**Default:** Client recycled every 1500 transactions (DB_CLIENT_RECYCLE_COUNT)

**Why:** Prevents stale connections and connection issues in long-running processes

**Configuration:**
```typescript
// Constant is exported from @eclesia/indexer-engine
// Default value: 1500
```

**Monitoring:**
```bash
# Check active connections
SELECT count(*) FROM pg_stat_activity WHERE datname = 'your_database';
```

### Maintenance

Run regular maintenance to prevent performance degradation:

```sql
-- Analyze statistics (run daily)
ANALYZE;

-- Vacuum to reclaim space (run weekly)
VACUUM;

-- Full vacuum with analyze (run monthly during low traffic)
VACUUM FULL ANALYZE;

-- Reindex if indexes become bloated (run quarterly)
REINDEX DATABASE your_database;
```

**Automate with cron:**
```bash
# Daily analyze at 2 AM
0 2 * * * psql -d your_database -c "ANALYZE;"

# Weekly vacuum at 3 AM Sunday
0 3 * * 0 psql -d your_database -c "VACUUM;"
```

## Application Tuning

### Node.js Memory

Increase heap size for better performance:

```bash
# 4GB heap
NODE_OPTIONS="--max-old-space-size=4096" npm start

# 8GB heap (for very large chains)
NODE_OPTIONS="--max-old-space-size=8192" npm start
```

**Rule of thumb:** Allocate 1-2GB per 500 batch size

### Logging Level

**Production:** `info` or `warn`
```typescript
{
  logLevel: "info"
}
```

**Development:** `debug` or `verbose`
```typescript
{
  logLevel: "debug"  // More detailed logs
}
```

**Performance impact:**
- `debug`/`verbose` = ~5-10% slower due to I/O
- `silly` = ~15-20% slower, very verbose

### Module Selection

Only enable required modules:

```typescript
{
  modules: ["cosmos.bank.v1beta1", "cosmos.staking.v1beta1"]
  // Don't include auth if not needed
}
```

**Impact:** Each module adds processing overhead and RPC calls

## Hardware Recommendations

### Minimum Requirements
- CPU: 2 cores
- RAM: 4GB
- Storage: 50GB SSD
- Network: 10 Mbps

**Performance:** ~100-200 blocks/sec

### Recommended Production
- CPU: 4-8 cores
- RAM: 16GB
- Storage: 500GB NVMe SSD
- Network: 100 Mbps

**Performance:** ~500-1000 blocks/sec

### High-Performance Setup
- CPU: 8-16 cores
- RAM: 32-64GB
- Storage: 1TB+ NVMe SSD (RAID 10)
- Network: 1 Gbps
- Local RPC node on same network

**Performance:** ~1000-2000+ blocks/sec

### Storage Considerations

**Database Growth Rates:**
- Minimal indexing: ~1-5 GB/month
- Full indexing with all modules: ~10-50 GB/month

**Depends on:**
- Chain activity (transactions/block)
- Number of modules enabled
- Retention period

**Recommendations:**
- Use SSD/NVMe storage (10-100x faster than HDD)
- Monitor disk usage with alerts
- Plan for 6-12 months growth
- Consider archiving old data

## Network Optimization

### RPC Node Selection

**Best:** Local RPC node on same server/network
- Lowest latency (<1ms)
- No bandwidth limits
- Most reliable

**Good:** RPC node in same datacenter
- Low latency (1-10ms)
- High bandwidth
- Reliable connection

**Acceptable:** Public RPC endpoint
- Higher latency (50-200ms)
- May have rate limits
- Less reliable

### RPC Timeouts

Adjust based on network conditions:

```typescript
// In constants.ts (modify if needed)
export const RPC_TIMEOUT_MS = 20000;  // 20 seconds (default)
```

**Slow networks:** Increase to 30000-60000ms
**Fast local network:** Can reduce to 10000-15000ms

## Benchmarking

Run benchmarks to establish baseline performance:

```bash
pnpm bench
```

**Key Metrics to Track:**
- Map operations throughput
- JSON stringify/parse speed
- Block processing time
- Memory allocation patterns

**Baseline Performance:**
- Map operations: ~35,000 ops/sec
- Block header processing: ~900 blocks/sec (in memory)
- JSON stringify: ~650 blocks/sec

## Monitoring Performance

### Key Metrics

**Track these metrics in production:**

1. **Indexing Rate**
   ```promql
   rate(indexer_blocks_indexed_total[1m])
   ```
   Target: >500 blocks/sec for live sync

2. **Blocks Behind**
   ```promql
   indexer_blocks_behind
   ```
   Target: <100 blocks

3. **Block Processing Duration (p95)**
   ```promql
   histogram_quantile(0.95, rate(indexer_block_processing_duration_seconds_bucket[5m]))
   ```
   Target: <0.1 seconds

4. **Memory Usage**
   ```promql
   nodejs_heap_size_used_bytes / nodejs_heap_size_total_bytes
   ```
   Target: <80%

5. **Database Query Duration (p95)**
   ```promql
   histogram_quantile(0.95, rate(indexer_database_query_duration_seconds_bucket[5m]))
   ```
   Target: <0.05 seconds

### Performance Alerts

Set up alerts for:
- Blocks behind > 1000 for 5+ minutes
- Indexing rate < 100 blocks/sec for 5+ minutes
- Memory usage > 90%
- Block processing p95 > 1 second
- Error rate > 10 errors/minute

## Optimization Strategies

### 1. Optimize Critical Path

**Profile:** Identify slowest operations
```bash
node --prof your-indexer.js
node --prof-process isolate-*.log > profile.txt
```

**Focus on:**
- Database queries (add indexes)
- RPC calls (batch when possible)
- JSON parsing (use streaming for large data)
- Event processing (optimize handlers)

### 2. Database Query Optimization

**Use EXPLAIN ANALYZE:**
```sql
EXPLAIN ANALYZE
SELECT * FROM balances WHERE address = 'cosmos1...';
```

**Look for:**
- Sequential scans (add indexes)
- High execution time
- Many rows scanned

**Optimize:**
- Add covering indexes
- Use partial indexes for filtered queries
- Consider materialized views for complex aggregations

### 3. Caching Strategy

**Already Implemented:**
- LRU cache for validator addresses (max 1000)
- LRU cache for validator data (max 500)

**Additional Caching:**
Consider application-level caching for:
- Genesis balances (read-once data)
- Staking parameters (rarely change)
- Module accounts (static)

### 4. Genesis Processing

For very large genesis files:

**Chunking** (now automatic):
- Commits every 5000 entries
- Prevents transaction timeout
- Better memory management

**Additional optimization:**
```bash
# Increase Node.js memory for genesis
NODE_OPTIONS="--max-old-space-size=8192" npm start
```

**Database tuning for genesis:**
```sql
-- Temporarily disable autovacuum
ALTER TABLE balances SET (autovacuum_enabled = false);

-- Import genesis

-- Re-enable and run manual vacuum
ALTER TABLE balances SET (autovacuum_enabled = true);
VACUUM ANALYZE balances;
```

### 5. Parallel Processing

The indexer already processes blocks in parallel via the queue system.

**Batch size** controls parallelism:
- Higher batch = more parallel processing
- Monitor CPU usage - should be 70-90% during sync

**Don't:**
- Run multiple indexers on same database
- Process same height range twice

## Performance Testing

### Load Testing

Test with historical data:

```typescript
{
  startHeight: 1000000,      // Start from historical height
  endHeight: 1001000,        // Process 1000 blocks
  batchSize: 500
}
```

**Measure:**
- Time to process 1000 blocks
- Memory peak usage
- Database size growth
- Error rate

### Stress Testing

Push limits to find bottlenecks:

```typescript
{
  batchSize: 1000,           // Maximum parallelism
  startHeight: 1
}
```

**Monitor:**
- CPU usage (should stay <90%)
- Memory usage (should stay <80%)
- Database connections
- Queue depth

## Scaling Strategies

### Vertical Scaling (Scale Up)

**Easiest approach:** Add more resources to single server
- More CPU cores → Better parallel processing
- More RAM → Larger batch sizes
- Faster storage → Better database performance

**Cost-effective until:** 16 cores, 64GB RAM

### Horizontal Considerations

**Current limitation:** One indexer per database

**Possible architectures:**
1. **Height-based partitioning:** Multiple indexers, different height ranges, separate databases
2. **Module-based partitioning:** Different indexers for different modules, separate databases
3. **Read replicas:** Single writer, multiple readers for queries

**Note:** Horizontal scaling requires application changes

## Resource Allocation

### Docker/Kubernetes

**Resource limits:**
```yaml
resources:
  limits:
    memory: "8Gi"
    cpu: "4"
  requests:
    memory: "4Gi"
    cpu: "2"
```

**Environment variables:**
```yaml
env:
  - name: NODE_OPTIONS
    value: "--max-old-space-size=6144"
  - name: LOG_LEVEL
    value: "info"
```

### PostgreSQL Resources

**Shared between indexer and queries:**
- Reserve 50% for indexer writes
- Reserve 50% for read queries

**Dedicated indexer database:**
- Can use 90% for writes
- 10% for monitoring queries

## Bottleneck Identification

### Symptoms & Solutions

#### CPU Bound
**Symptoms:** CPU at 100%, low I/O wait
**Solutions:**
- Add more CPU cores
- Reduce batchSize
- Optimize event handlers
- Use minimal indexing mode

#### I/O Bound
**Symptoms:** High I/O wait, CPU underutilized
**Solutions:**
- Use SSD/NVMe storage
- Add database indexes
- Tune PostgreSQL settings
- Increase shared_buffers

#### Network Bound
**Symptoms:** Low CPU/I/O, high network wait
**Solutions:**
- Use local RPC node
- Increase RPC timeout
- Check network bandwidth
- Reduce RPC call frequency

#### Memory Bound
**Symptoms:** High swap usage, OOM errors
**Solutions:**
- Increase Node.js heap size
- Reduce batchSize
- Monitor for memory leaks
- Use minimal indexing
- LRU caches prevent unbounded growth

## Performance Benchmarks

### Expected Performance

**Initial sync (from genesis):**
- Minimal mode: 500-1000 blocks/sec
- Full mode: 300-700 blocks/sec

**Live sync (keeping up):**
- Block time: ~6 seconds
- Processing time: <1 second/block
- Headroom: 6x capacity

**Genesis processing:**
- Small chains (<10K accounts): 1-2 minutes
- Medium chains (10K-100K): 5-15 minutes
- Large chains (100K-1M): 30-120 minutes

### Performance Tuning Results

After optimizations, expect:
- 50-100% throughput increase
- 30-50% memory reduction
- 60-80% database query time reduction

## Advanced Optimizations

### 1. Connection Recycling

Already implemented and tuned:
- Recycles every 1500 transactions
- Prevents connection degradation
- Automatically handles reconnection

### 2. Transaction Chunking

Genesis processing uses chunked transactions:
- Commits every 5000 entries
- Prevents long-running transactions
- Better for large genesis files

### 3. Query Optimization

**Use prepared statements** (already implemented in modules):
```typescript
await db.query({
  name: "get-balance",  // Cached query plan
  text: "SELECT * FROM balances WHERE address=$1",
  values: [address]
});
```

**Benefits:**
- Query plan caching
- Reduced planning overhead
- Better performance on repeated queries

### 4. Batch Operations

When processing multiple items, use batch operations:

```typescript
// Instead of individual inserts:
for (const account of accounts) {
  await db.query("INSERT INTO accounts...", [account]);
}

// Use batch insert:
await db.query(
  "INSERT INTO accounts SELECT * FROM UNNEST($1::text[])",
  [accounts]
);
```

**Performance:** 10-100x faster for bulk operations

## Monitoring Performance Over Time

### Baseline Metrics

Establish baseline after optimization:
- Blocks/second at different heights
- Memory usage patterns
- Database growth rate
- Query performance

### Regression Detection

Monitor for degradation:
```promql
# Indexing rate decreasing over time
delta(indexer_blocks_indexed_total[1h]) < 1800000  # <500 blocks/sec

# Memory usage increasing
rate(nodejs_heap_size_used_bytes[1h]) > 0  # Growing memory

# Query duration increasing
histogram_quantile(0.95, rate(indexer_database_query_duration_seconds_bucket[1h])) > 0.1
```

## Troubleshooting Performance Issues

See TROUBLESHOOTING.md for detailed performance issue diagnosis and solutions.

**Quick checklist:**
1. Check Prometheus metrics for bottlenecks
2. Review PostgreSQL slow query log
3. Monitor system resources (CPU, RAM, I/O)
4. Verify network latency to RPC
5. Check for errors in application logs
6. Run EXPLAIN ANALYZE on slow queries
7. Review database statistics (pg_stat_user_tables)

## Best Practices Summary

1. **Start conservative:** Default settings, monitor, then optimize
2. **Measure first:** Use metrics to identify actual bottlenecks
3. **One change at a time:** Test impact of each optimization
4. **Monitor continuously:** Performance can degrade over time
5. **Plan for growth:** Database and memory requirements increase
6. **Use SSD storage:** 10-100x faster than HDD for database
7. **Local RPC node:** Eliminates network latency
8. **Regular maintenance:** VACUUM, ANALYZE, REINDEX
9. **Capacity planning:** Plan for 2x current load
10. **Load testing:** Test before deploying configuration changes
