---
"@eclesia/indexer-engine": minor
---

- Event handlers now run one after another in registration order. They share one database connection and one transaction, so interleaving them at await points let two handlers touch the same rows in an unpredictable order, and a failure in one left the others mid-flight during the rollback. The uuid acknowledgement protocol that `asyncEmit` used internally is gone; `emit()` and `on()` are unchanged. `EclesiaEmitter.handlersFor()` exposes the registered handlers.
- A block subscription that errors or is closed by the node now triggers a recovery instead of going unnoticed until the idle check.
- A transaction log that is not JSON, or a single-message transaction without a log or `msg_index` attributes, no longer fails the block.
- New `chainId` option: the indexer refuses to start against an RPC that reports a different network.
- The RPC call duration metric is recorded for failed queries too. `PromiseQueue` is deprecated; the unused `dayjs` and `uuid` dependencies and the `start` script are removed.
