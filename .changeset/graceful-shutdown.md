---
"@eclesia/indexer-engine": minor
---

Replace process.exit() calls with graceful shutdown via fatal-error event emission. Allows parent processes to handle shutdown logic in containerized environments. Added fatal-error event type with error context including message and retry count.