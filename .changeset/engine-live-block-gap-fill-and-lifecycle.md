---
"@eclesia/indexer-engine": minor
---

Live-block and lifecycle fixes:

- WebSocket mode now fetches every height between the last one seen and the announced one, so a NewBlock event skipped by the subscription no longer leaves a permanent hole. Heights at or below the last one seen are ignored instead of moving the cursor backwards.
- Polling mode keeps exactly one polling chain across recoveries; previously every restart added another concurrent poller.
- `stop()` is now async and actually tears the indexer down: subscription, polling and inactivity timers, both RPC clients and the health and metrics servers. Reaching `endHeight` lets the process exit.
- `asyncEmit` removes its per-call `uuid` listener when a handler rejects; it used to leak one listener per failed event for the life of the process. A completion ack that arrives after its emit already rejected is now dropped instead of being re-emitted into a recursion.
- Every RPC and queue timeout clears its timer once the race settles (new `Utils.withTimeout`), the connect step has its own timeout per client and disconnects a client that arrives late, and timeouts reject with an `RPCError` instead of an empty array or `false`.
