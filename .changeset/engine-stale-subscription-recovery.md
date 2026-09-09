---
"@eclesia/indexer-engine": patch
---

Fix a restart loop after an RPC failure in WebSocket mode. Every restart disconnects the previous client, which completes the previous block subscription; that completion requested a recovery against the run that was just starting, so each attempt died immediately and the backoff grew to five minutes. Seen on AtomOne after a burst of block-fetch timeouts: 23 consecutive "block subscription closed by the node" recoveries with no block processed. The subscription listener now carries the generation it was created for, and the previous subscription is detached before the socket is closed.
