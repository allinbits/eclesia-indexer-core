---
"@eclesia/core-modules-pg": minor
---

Add LRU cache for validator address lookups to prevent unbounded memory growth. Replaced Map-based caches with LRUCache (max 1000 validator addresses, max 500 validator data entries). Reduces database queries and improves performance for validator lookups.