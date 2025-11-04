---
"@eclesia/indexer-engine": minor
---

Implement chunked transaction processing for large genesis files. Genesis array processing now commits transactions every 5 chunks (5000 entries) to prevent timeouts. Improves handling of large genesis files with better memory management and transaction boundaries.