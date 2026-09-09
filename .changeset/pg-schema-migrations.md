---
"@eclesia/basic-pg-indexer": minor
---

- `PgIndexer.applyMigrations(module, migrations, baselineTable)` and `loadMigrations(dir)` add versioned schema migrations recorded in a `schema_migrations` table. A database created before migrations existed is baselined at version 1 without re-running it, so existing deployments upgrade in place.
- `synchronous_commit` is now set once per connection instead of on every `getInstance()` call, and `synchronousCommit: true` keeps it on.
- `getNextHeight()` and `shouldProcessGenesis()` fall back to the engine's default start height when `startHeight` is omitted instead of returning `undefined`.
