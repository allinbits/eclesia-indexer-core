---
"@eclesia/core-modules-pg": minor
---

- Every module's schema is now a set of numbered migrations applied through `PgIndexer.applyMigrations`. The previous `module.sql` files became migration 001; existing databases are baselined automatically.
- Migration 002 (blocks): block timestamps are stored as `TIMESTAMPTZ`, so values no longer depend on the indexer host's time zone. Existing rows are reinterpreted in the database session's time zone.
- Migration 002 (staking): `voting_power` and `min_self_delegation` become `NUMERIC` (18-decimal chains overflowed `BIGINT`), `staking_pool` is unique per height instead of per token pair, lookup indexes are added for the latest-row queries on descriptions, commissions and voting powers, and a duplicate index is dropped.
- The `EventMap` augmentation for module events is emitted into the published types.
