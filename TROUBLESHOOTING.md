# Troubleshooting Guide

This guide helps diagnose and resolve common issues with the Eclesia Indexer.

## Common Errors

### Database Connection Issues

#### Error: "ECONNREFUSED" or "Connection refused"

**Symptoms:**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Causes:**
- PostgreSQL is not running
- Wrong connection string
- Firewall blocking connection
- Wrong port number

**Solutions:**
1. Verify PostgreSQL is running:
   ```bash
   pg_isready -h localhost -p 5432
   ```

2. Check connection string format:
   ```
   postgresql://username:password@host:port/database
   ```

3. Test connection manually:
   ```bash
   psql postgresql://user:pass@localhost:5432/dbname
   ```

4. Check PostgreSQL logs for errors

#### Error: "too many clients"

**Symptoms:**
```
Error: sorry, too many clients already
```

**Causes:**
- Max connections limit reached
- Connection leak in application
- Multiple indexers sharing same database

**Solutions:**
1. Increase PostgreSQL `max_connections` in postgresql.conf
2. Reduce number of concurrent indexers
3. Check for connection leaks (connections not properly closed)
4. Verify DB_CLIENT_RECYCLE_COUNT is set appropriately (default: 1500)

### RPC Connection Issues

#### Error: "Could not connect to RPC"

**Symptoms:**
- Indexer fails to start
- "Could not connect to RPC" in logs

**Causes:**
- RPC endpoint not accessible
- Wrong RPC URL
- Network issues
- RPC node not synced

**Solutions:**
1. Verify RPC endpoint:
   ```bash
   curl http://localhost:26657/status
   ```

2. Check RPC URL in config (should include http:// or https://)

3. Test RPC connectivity:
   ```bash
   curl http://your-rpc:26657/block?height=1
   ```

4. Ensure RPC node is fully synced

#### Error: "RPC timeout" or slow responses

**Symptoms:**
- Frequent timeout errors
- Slow indexing speed
- Connection timeout errors

**Causes:**
- RPC node overloaded
- Network latency
- Large block responses
- Connection establishment delays

**Solutions:**
1. Use a local RPC node if possible to reduce network latency
2. Reduce batchSize in configuration to lower concurrent load
3. Check RPC node performance and resources
4. A failed or timed-out fetch (RPC_TIMEOUT_MS, 20 s) triggers a restart with exponential backoff, 5 s doubling up to 5 min. Restarts are unlimited unless `maxRetries` is set. The timeouts themselves are compile-time constants in `@eclesia/indexer-engine` and cannot be changed through configuration yet.

### Genesis Processing Issues

#### Warning: "shouldProcessGenesis() returned true but no genesisPath is configured"

**Symptoms:**
```
[WARN]: shouldProcessGenesis() returned true but no genesisPath is configured, skipping genesis import
```
Indexing starts at block 1 without genesis state, so module balances and delegations are incomplete.

**Causes:**
- processGenesis enabled but no genesisPath provided

Note that `StakingModule` needs a genesis import: its schema links every block's proposer to the `validators` table, so without genesis (or with a start height above 1) blocks fail to insert.

**Solutions:**
1. Provide genesisPath in configuration:
   ```typescript
   {
     processGenesis: true,
     genesisPath: "/path/to/genesis.json"
   }
   ```

2. Or disable genesis processing:
   ```typescript
   {
     processGenesis: false
   }
   ```

#### Genesis processing timeout

**Symptoms:**
- Process hangs during genesis import
- Transaction timeout errors

**Causes:**
- Very large genesis file
- Insufficient memory
- Database performance issues

**Solutions:**
1. Chunked processing is now automatic (commits every 5000 entries)
2. Increase database statement_timeout
3. Allocate more memory to Node.js:
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" npm start
   ```
4. Monitor progress with debug logging: `logLevel: "debug"`

### Block Processing Issues

#### Indexer stuck or not progressing

**Symptoms:**
- Height not increasing
- No new blocks indexed
- Block listener setup failures

**Causes:**
- Queue full/blocked
- Transaction not committed
- Error in block processing
- Block listener failed to initialize
- RPC connection issues

**Solutions:**
1. Check logs for errors (especially block listener setup errors)
2. Monitor queue depth metric via Prometheus endpoint
3. Verify database transactions are committing successfully
4. Check RPC connectivity and CONNECT_TIMEOUT_MS setting
5. Look for module-specific errors in logs
6. The indexer now automatically recovers from block listener setup failures
7. Verify database connection hasn't been recycled mid-transaction (check DB_CLIENT_RECYCLE_COUNT)

#### Blocks behind increasing

**Symptoms:**
- Gap between current and latest height growing

**Causes:**
- Processing slower than block production
- Database bottleneck
- Module processing overhead

**Solutions:**
1. Increase batchSize for parallel processing
2. Optimize database queries (add indexes)
3. Use faster hardware/SSD storage
4. Disable unnecessary modules
5. Use minimal indexing mode if full data not needed

### Module Errors

#### Error: "Module X not found"

**Symptoms:**
```
Error: Module cosmos.bank.v1beta1 not found
```

**Causes:**
- Module not installed
- Dependency module missing
- Module name typo

**Solutions:**
1. Verify module is in modules array
2. Check module dependencies are installed
3. Ensure module order matches dependency graph

#### Error: "Migration N (name) for <module> failed"

**Symptoms:**
- Module setup fails on start
- The log names the module, the migration version and the SQL error

**How schema changes work:**
Each module ships numbered SQL files (`sql/001_initial.sql`, `sql/002_...sql`). On every start, `PgIndexer.applyMigrations` records what has been applied in the `schema_migrations` table and runs the rest in order, each in its own transaction. A database created before migrations existed is recognised by its existing tables and baselined at version 1 without re-running it.

**Causes:**
- PostgreSQL user lacks `CREATE` or `ALTER` permission
- A migration conflicts with manual changes made to the schema
- A previous migration was applied by hand without being recorded

**Solutions:**
1. Check the PostgreSQL user has CREATE TABLE and ALTER TABLE permission
2. Read the SQL error in the log; the failed migration was rolled back and nothing was recorded, so fixing the cause and restarting re-applies it
3. If the change was already applied manually, record it: `INSERT INTO schema_migrations(module, version, name) VALUES ('<module>', N, '<name>')`
4. Inspect state with `SELECT * FROM schema_migrations ORDER BY module, version`

## Debugging Tips

### Enable Debug Logging

```typescript
{
  logLevel: "debug" // or "verbose" for even more detail
}
```

### Check Health Endpoint

The indexer exposes a health check endpoint:
```bash
curl http://localhost:8888/health
```

Response includes:
- Status: `CONNECTING` while starting, `OK` while processing blocks, `WAITING` when caught up and the chain has produced no new block (HTTP 200), `FAILED` after an error (HTTP 503, until the restart succeeds)

### Monitor Metrics

If Prometheus metrics enabled:
```bash
curl http://localhost:9090/metrics
```

Key metrics to check:
- `indexer_blocks_behind` - How far behind chain tip
- `indexer_errors_total` - Total error count
- `indexer_queue_depth` - Queue size
- `indexer_block_processing_duration_seconds` - Processing speed

### Database Inspection

Check last indexed block:
```sql
SELECT * FROM blocks ORDER BY height DESC LIMIT 1;
```

Check for errors in specific module:
```sql
-- Example for validators
SELECT COUNT(*) FROM validators;
SELECT * FROM validator_infos ORDER BY height DESC LIMIT 10;
```

### Common SQL Queries

Check table sizes:
```sql
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

Find slow queries:
```sql
SELECT
  query,
  calls,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

## Performance Issues

### Slow Indexing

**Symptoms:**
- Low blocks/second rate
- High processing duration

**Diagnosis:**
1. Check RPC response times
2. Monitor database query duration
3. Check CPU/memory usage
4. Look for blocking operations in logs

**Solutions:**
1. Increase batchSize (test with 500-1000)
2. Add database indexes on frequently queried columns
3. Use connection pooling
4. Optimize module event handlers
5. Consider using minimal mode

### High Memory Usage

**Symptoms:**
- Memory growing over time
- Out of memory errors
- Slow garbage collection

**Diagnosis:**
1. Monitor nodejs_heap_size_used_bytes metric
2. Check for memory leaks
3. Look for large object accumulation

**Solutions:**
1. LRU caches now limit memory growth (validator caches)
2. Reduce batchSize
3. Implement periodic garbage collection hints
4. Profile with Node.js --inspect flag

### Database Performance

**Symptoms:**
- Slow query execution
- High database CPU
- Lock timeouts

**Solutions:**
1. Add indexes:
   ```sql
   CREATE INDEX idx_blocks_height ON blocks(height);
   CREATE INDEX idx_balances_address ON balances(address);
   CREATE INDEX idx_validators_consensus ON validators(consensus_address);
   ```

2. Vacuum regularly:
   ```sql
   VACUUM ANALYZE;
   ```

3. Tune PostgreSQL settings:
   - shared_buffers = 25% of RAM
   - effective_cache_size = 50% of RAM
   - work_mem = 50MB

## FAQ

### Q: Can I run multiple indexers on the same database?

A: Not recommended. Multiple indexers will conflict on block heights and cause transaction issues. Use a single indexer instance per database.

### Q: How do I resume indexing after a crash?

A: The indexer automatically resumes from the last successfully indexed block by querying the database for the highest block height.

### Q: Can I index from a specific height?

A: Yes, set startHeight in configuration. It is used only when the database has no blocks yet; otherwise indexing resumes from the highest stored height plus one.

### Q: How do I skip genesis processing?

A: Set `processGenesis: false` or ensure `startHeight > 1`.

### Q: What's the difference between minimal and full indexing?

A: Minimal mode indexes only blocks and basic data. Full mode includes validator data, delegations, and requires more RPC calls.

### Q: How do I handle chain upgrades?

A: A halted chain is not an error. Once caught up, the indexer waits for the next block with no timeout, reports `WAITING` on the health endpoint, and checks the chain height every 30 s. When blocks resume it continues from where it stopped. Module schema changes ship as versioned migrations that are applied on the next start.

### Q: Can I add custom modules?

A: Yes! Implement the IndexingModule interface and add to the modules array. See existing modules for examples.

## Getting Help

If you encounter issues not covered here:

1. Check GitHub Issues: https://github.com/your-repo/issues
2. Enable debug logging and share logs
3. Include configuration (redact sensitive data)
4. Provide error messages and stack traces
5. Note PostgreSQL and Node.js versions

## Error Recovery Strategies

### Automatic Recovery

The indexer includes automatic recovery for:
- **RPC connection failures and timed-out fetches** - Restart with exponential backoff (5 s doubling up to 5 min), unlimited unless `maxRetries` is set
- **Transient database errors** - The block's transaction is rolled back and the block is retried after a restart
- **Dropped database connections** - A fresh client is created on the next query; a drop during a block rolls that block back
- **Dead WebSocket subscriptions** - Detected when the chain height advances without a block being announced; heights skipped by the subscription are fetched
- **Idle chains** - Not treated as an error: the indexer waits, reports `WAITING`, and resumes when blocks appear
- **Database connection recycling** - The client is replaced every 1500 committed transactions to prevent stale connections

### When the indexer gives up

`fatal-error` is emitted, and `PgIndexer` stops and exits the process with code 1 (set `exitOnFatal: false` to handle it yourself), when:
- one block fails 5 times in a row after its data was fetched (`maxFailuresPerBlock`). A failure that survives a restart is a handler bug, a schema mismatch or bad data, and retrying it forever would hide it. The log names the height; the `fatal-error` payload carries it as `height`. A database outage longer than the five attempts (about 2.5 minutes) trips this too, which is what the orchestrator restart is for.
- `maxRetries` consecutive restarts failed, when that option is set.

#### Error: "A previous genesis import did not complete"

Genesis is imported in chunks that commit every 5,000 entries. If the process dies part-way, the committed chunks stay in the database and importing again on top of them would double every balance and delegation, so the indexer refuses to start. Drop the database (or its `public` schema) and start again. The `genesis_import` table records the import's state.

### Manual Recovery

For persistent issues:

1. Stop the indexer gracefully (SIGTERM)
2. Investigate root cause
3. Fix configuration/infrastructure
4. Restart indexer (will resume from last height)

### Database Recovery

If database is corrupted:

1. Backup current state
2. Drop and recreate schema
3. Restart indexer (will reindex from startHeight)
4. For partial recovery, manually set starting point:
   ```sql
   DELETE FROM blocks WHERE height > X;
   ```

## Best Practices

1. Always use connection strings with credentials, not trust auth
2. Monitor disk space (database grows continuously)
3. Set up log rotation for application logs
4. Use Prometheus + Grafana for production monitoring
5. Test configuration changes in non-production first
6. Keep PostgreSQL and dependencies updated
7. Implement database backups
8. Use pre-commit hooks to catch issues early
9. Monitor connection recycling metrics (default: every 1500 transactions)
10. Leverage automatic retry mechanisms by implementing proper error handling
11. Track error metrics via Prometheus for early problem detection
12. Adjust CONNECT_TIMEOUT_MS and RPC_TIMEOUT_MS based on network conditions

## Recent Improvements

The indexer has recently received several reliability enhancements:

- **Connection Management**: Automatic database client recycling prevents long-running connection issues
- **Retry Logic**: Improved retry counting ensures failures are tracked accurately
- **Block Listener Recovery**: Automatic recovery from block listener setup failures
- **Error Metrics**: Enhanced error tracking provides better visibility into indexer health
- **Performance Optimizations**: Better insert and stringify performance reduces processing bottlenecks

For details on these improvements, see the [CHANGELOG.md](CHANGELOG.md).
