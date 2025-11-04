---
"@eclesia/indexer-engine": minor
"@eclesia/basic-pg-indexer": patch
"@eclesia/core-modules-pg": patch
---

Extract magic numbers to named constants with comprehensive documentation. Created new constants module containing:
- DEFAULT_BATCH_SIZE (500): Block prefetch queue size
- DEFAULT_START_HEIGHT (1): Initial indexing height
- DEFAULT_HEALTH_CHECK_PORT (8080): Health check server port
- DEFAULT_POLLING_INTERVAL_MS (5000): RPC polling interval
- RPC_TIMEOUT_MS (20000): Timeout for RPC calls
- QUEUE_DEQUEUE_TIMEOUT_MS (30000): Queue operation timeout
- DB_CLIENT_RECYCLE_COUNT (1500): Database connection recycling threshold
- PERIODIC_INTERVALS: Event emission intervals (50, 100, 1000 blocks)
- PAGINATION_LIMITS: Query pagination sizes (VALIDATORS: 1000n, DELEGATIONS: 250n)
- GENESIS_BATCH_SIZE (1000): Genesis file processing batch size

All magic numbers throughout the codebase now reference these documented constants, improving code maintainability and making configuration tuning easier.
