---
"@eclesia/core-modules-pg": patch
---

`getConsensusAddress` now falls back to the `validators` table on a cache miss (instead of immediately throwing "No consensus address"), so an evicted `validatorAddressCache` (LRU, capped at 1000) entry or a not-yet-warmed cache after a restart no longer crashes block processing. It only throws when the validator is genuinely absent from the database.
