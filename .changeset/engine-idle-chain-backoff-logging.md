---
"@eclesia/indexer-engine": minor
---

Resilience, logging and typing:

- An idle chain is no longer an error. When caught up, the indexer waits for the next block without a timeout and without holding a database transaction, reports `WAITING` on the health endpoint (HTTP 200) and in the new `indexer_waiting_for_blocks` gauge, and checks the chain height every 30 s. Recovery is triggered only when the chain has advanced without a block being announced (a dead subscription) or the RPC is unreachable.
- Restarts use exponential backoff from 5 s up to 5 min and are unlimited by default; set `maxRetries` to restore a fatal-error after a fixed number of consecutive failures. Callbacks left over from a previous run can no longer trigger a recovery in the current one.
- Logging goes to stdout only. The `error.log` / `combined.log` files in the working directory are gone. Errors keep their stack, `logFormat: "json"` selects JSON output, and the RPC URL is logged with its password masked.
- `healthCheckHost` and `prometheusHost` control the bind address of the two HTTP servers (default `0.0.0.0`).
- `endHeight` is honoured exactly: the block at `endHeight` is the last one processed and the fetcher stops there.
- The global `EventMap` declaration is now emitted into the published types, so consumers get typed `on()` handlers without declaring it themselves.
- Genesis parsing moved to stream-json 3 and stream-chain 4, clearing the last production audit advisory. The genesis progress counter now reports real numbers.
- A `shouldProcessGenesis()` result of true with no `genesisPath` is logged as a warning instead of being skipped silently.
