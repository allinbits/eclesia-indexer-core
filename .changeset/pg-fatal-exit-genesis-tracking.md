---
"@eclesia/basic-pg-indexer": minor
---

- On `fatal-error` the indexer stops and exits the process with code 1; `exitOnFatal: false` opts out.
- Genesis imports are recorded in a `genesis_import` table. A start on top of a partial import is refused with an explanation instead of importing again; a completed import is never repeated even before the first block is stored.
- The silly-mode client is a proxy that times `query()` and forwards every other method, so modules see the same client shape at every log level.
- Client recycling runs only after a successful commit and outside the transaction error handling, so a recycling failure no longer masks a commit or rollback error.
- `run()` no longer opens a separate RPC connection before `start()` opens its own.
