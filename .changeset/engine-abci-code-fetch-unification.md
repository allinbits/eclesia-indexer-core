---
"@eclesia/indexer-engine": patch
---

- `callABCI` honours the ABCI response code. An error reply (pruned height, unknown path) is thrown as an `RPCError` carrying the code and log instead of decoding as an empty result; it no longer triggers a recovery for ad-hoc module queries, which can catch it.
- The validator set is fetched with pagination, so chains with more than 1000 validators are no longer truncated.
- An `http(s)://` RPC URL with `usePolling: false` now switches to polling with a warning at construction time instead of failing after several restarts.
- Explicit `undefined` configuration values no longer override the defaults.
- Live blocks go through the same fetcher as the initial catch-up, which waits for queue space instead of overwriting or restarting when the queue is full at the sync boundary.
- `EclesiaEmitter.off()` only removes handlers that were registered and supports the same handler registered more than once; `CircularBuffer` refuses to overwrite when full and throws on a dequeue without a pending item.
