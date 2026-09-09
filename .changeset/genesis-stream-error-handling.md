---
"@eclesia/indexer-engine": patch
---

Genesis import no longer crashes the process when a `genesis/*` handler or the JSON parser fails. The stream chains had no `error` listener, so any failure surfaced as an uncaught exception and the surrounding transaction was never rolled back. Errors now reject the reader, `parseGenesis` rolls back, and the cause is logged.
