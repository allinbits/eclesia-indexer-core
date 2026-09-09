---
"@eclesia/basic-pg-indexer": minor
---

Every database client is now built by one factory with `error` and `end` listeners attached, and a reconnect after a dropped or failed connection always uses a fresh client. Previously the reconnect path created listener-less clients (a second disconnect crashed the process with an unhandled `error` event) and `beginTransaction` tried to reconnect a client node-postgres refuses to reuse. Adds `PgIndexer.stop()`, which stops the engine and closes the database connection.
