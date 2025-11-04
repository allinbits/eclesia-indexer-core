---
"@eclesia/indexer-engine": minor
"@eclesia/basic-pg-indexer": patch
---

Add comprehensive configuration validation at startup. New validation utilities check:
- RPC URL format and protocol (http/https/ws/wss)
- Database connection string format (PostgreSQL)
- File path existence and readability (genesis files)
- Port numbers (1-65535 range)
- Positive integers for batch sizes, heights, and intervals

Validation occurs in constructors before initialization, providing early error detection with detailed error messages using the new ConfigurationError class. This prevents runtime failures and improves debugging experience.
