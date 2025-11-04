---
"@eclesia/indexer-engine": minor
---

Replace console.error in promise queues with proper winston logger integration. Queue classes (PromiseQueue and CircularBuffer) now accept an optional error handler callback that gets called when enqueue failures occur. The indexer passes a logger-based error handler to queues, ensuring consistent logging throughout the application.

Breaking change: Queue constructor signatures now accept optional second parameter for error handling. Existing code without error handlers will continue to work (backward compatible), but enqueue errors will be silently ignored instead of using console.error.

Logger is now initialized before queue creation to enable proper error handling integration.
