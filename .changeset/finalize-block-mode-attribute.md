---
"@eclesia/indexer-engine": patch
---

Fix `begin_block` / `end_block` events being empty on CometBFT 0.38 / Cosmos SDK 0.50+ chains. The engine filtered `finalize_block_events` on `mode == "begin_block"` / `"end_block"`, but the SDK stamps `mode=BeginBlock` / `mode=EndBlock` (baseapp.go), so no event ever matched and bank, staking and any custom begin/end-block handlers received empty event lists. The comparison now matches the SDK's spelling (and still accepts the snake_case forms) via the new `Utils.hasBlockEventMode` helper.
