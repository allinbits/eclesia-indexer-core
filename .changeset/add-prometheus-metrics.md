---
"@eclesia/indexer-engine": minor
---

Add Prometheus metrics export for production monitoring. Created IndexerMetrics class with metrics for blocks indexed, queue depth, error rates, and processing durations. Includes default Node.js metrics and exposes Prometheus-formatted metrics endpoint.