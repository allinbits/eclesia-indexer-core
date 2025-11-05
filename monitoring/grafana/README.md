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

## Metrics Endpoints

Expose metrics in your application:

```typescript
import { IndexerMetrics } from "@eclesia/indexer-engine";

const metrics = new IndexerMetrics();

// In your HTTP server:
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", metrics.registry.contentType);
  res.end(await metrics.getMetrics());
});
```

## Alerting

Recommended alerts:
- Blocks behind > 1000 for more than 5 minutes
- Error rate > 10 errors/minute
- Block processing p95 > 1 second
- Memory usage > 80% of available
- Event loop lag > 100ms
