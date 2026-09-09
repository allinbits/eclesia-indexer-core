# Grafana Dashboards for Eclesia Indexer

This directory contains Grafana dashboard templates for monitoring the Eclesia Indexer.

## Available Dashboards

### indexer-dashboard.json
Main monitoring dashboard with the following panels:

**Indexing Progress:**
- Block indexing progress (current height vs chain height)
- Blocks behind chain tip
- Queue depth
- Indexing rate (blocks/second)
- Indexer state: `INDEXING` or `WAITING FOR BLOCKS` (from `indexer_waiting_for_blocks`, which is 1 while the indexer is caught up and the chain has produced no new block)

**Error Monitoring:**
- Error rates by type
- RPC error rate
- Database error rate

**Performance Metrics:**
- Block processing duration (p95, p99)
- RPC call duration by method (p95)
- Database query duration by type (p95)

**System Health:**
- Memory usage (heap used, total, external)
- Event loop lag

## Setup

1. Ensure Prometheus is scraping your indexer's /metrics endpoint
2. Import the dashboard JSON into Grafana
3. Configure the Prometheus data source
4. Adjust refresh rates and time ranges as needed

## Customization

You can customize dashboards by:
- Adjusting refresh intervals (default: 10s)
- Modifying threshold values for alerts
- Adding new panels for custom metrics
- Changing time ranges and aggregation windows

## Metrics Endpoint

The engine serves `/metrics` itself when `enablePrometheus: true` is set, on `prometheusPort` (default 9090) and `prometheusHost` (default `0.0.0.0`). No extra HTTP server is needed:

```typescript
const config: PgIndexerConfig = {
  // ...
  enablePrometheus: true,
  prometheusPort: 9090,
  prometheusHost: "127.0.0.1", // keep it off public interfaces unless a scraper needs it
};
```

## Exported Metrics

| Metric | Type | Meaning |
|--------|------|---------|
| `indexer_blocks_indexed_total` | counter | Blocks committed |
| `indexer_current_height` | gauge | Height of the last processed block |
| `indexer_latest_chain_height` | gauge | Chain height as last reported by the RPC |
| `indexer_blocks_behind` | gauge | Difference between the two |
| `indexer_queue_depth` | gauge | Prefetched blocks waiting to be processed |
| `indexer_waiting_for_blocks` | gauge | 1 while caught up and waiting for the chain to produce a block |
| `indexer_retry_count` | gauge | Consecutive restart attempts (0 after a successful block) |
| `indexer_errors_total{type}` | counter | Errors by type: `rpc`, `database`, `block`, `genesis_error`, `init_error`, `health_check_server`, `metrics_server` |
| `indexer_rpc_errors_total`, `indexer_processing_errors_total`, `indexer_database_errors_total` | counter | Per-category error counters |
| `indexer_block_processing_duration_seconds` | histogram | Time to process one block |
| `indexer_rpc_call_duration_seconds{method}` | histogram | ABCI query latency by path |
| `indexer_database_query_duration_seconds{query_type}` | histogram | Query latency by prepared-statement name |
| `indexer_transactions_processed_total` | counter | Transactions processed |
| `nodejs_*`, `process_*` | various | Default Node.js process metrics |

## Health Endpoint

Separate from metrics, `/health` on `healthCheckPort` (default 8888) returns `{"status": ...}`:

| Status | HTTP | Meaning |
|--------|------|---------|
| `CONNECTING` | 503 | Starting up |
| `OK` | 200 | Processing blocks |
| `WAITING` | 200 | Caught up; the chain has produced no new block yet |
| `FAILED` | 503 | An error occurred; a restart with backoff is pending |

## Recommended Alerts

- `indexer_blocks_behind > 100` for 10 minutes while `indexer_waiting_for_blocks == 0`: the indexer is falling behind a live chain
- `indexer_retry_count >= 3`: repeated restarts, check RPC and database
- `rate(indexer_errors_total{type="database"}[5m]) > 0`: database errors
- `/health` returning 503 for more than 5 minutes

## Alerting

Recommended alerts:
- Blocks behind > 1000 for more than 5 minutes
- Error rate > 10 errors/minute
- Block processing p95 > 1 second
- Memory usage > 80% of available
- Event loop lag > 100ms
