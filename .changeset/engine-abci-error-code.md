---
"@eclesia/indexer-engine": patch
---

`RPCError` thrown by `callABCI` for a non-zero ABCI response now carries the chain's answer as `abciCode` and `abciLog` (and the queried `height`), so a module can tell "the chain answered with an error" from "the RPC is unreachable" without parsing the message. Transport failures leave `abciCode` undefined.
