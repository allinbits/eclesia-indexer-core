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

**Causes:**
- RPC node overloaded
- Network latency
- Large block responses

**Solutions:**
1. Increase RPC_TIMEOUT_MS constant (default: 20000ms)
2. Use local RPC node if possible
3. Reduce batchSize in configuration
4. Check RPC node performance and resources

### Genesis Processing Issues

#### Error: "Genesis path not set"

**Symptoms:**
```
Error: Genesis path not set
```

**Causes:**
- processGenesis enabled but no genesisPath provided

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

**Causes:**
- Queue full/blocked
- Transaction not committed
- Error in block processing

**Solutions:**
1. Check logs for errors
2. Monitor queue depth metric
3. Verify database transactions are committing
4. Check RPC connectivity
5. Look for module-specific errors

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

#### Error: "Database not configured"

**Symptoms:**
- Module setup fails
- Table creation errors

**Causes:**
- Tables not created
- Migration not run
- Permission issues

**Solutions:**
1. Module should auto-create tables on first run
2. Check PostgreSQL user has CREATE TABLE permission
3. Look for SQL errors in logs
4. Manually run SQL from module's sql/module.sql file

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
curl http://localhost:8080/health
```

Response includes:
- Status (OK, DEGRADED, ERROR)
- Current height
- Latest height
- Uptime

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

A: Yes, set startHeight in configuration. The indexer will use max(startHeight, lastIndexedHeight + 1).

### Q: How do I skip genesis processing?

A: Set `processGenesis: false` or ensure `startHeight > 1`.

### Q: What's the difference between minimal and full indexing?

A: Minimal mode indexes only blocks and basic data. Full mode includes validator data, delegations, and requires more RPC calls.

### Q: How do I handle chain upgrades?

A: The indexer should continue working through upgrades. If schema changes are needed, you may need to run migrations or adjust module handlers.

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
- RPC connection failures (3 retries with exponential backoff)
- Transient database errors (transaction rollback)
- WebSocket disconnections (automatic reconnection)

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
