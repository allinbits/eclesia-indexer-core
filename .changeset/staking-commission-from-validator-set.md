---
"@eclesia/core-modules-pg": patch
---

Staking: validator commission changes are now recorded from the validator set the indexer already fetches every block, not only from `MsgEditValidator`. Changes made without a transaction were missed before: AtomOne's v4 upgrade handler capped every commission rate at 5% at block 9550000, and the database kept the old rate (7–18%) for 59 validators, which later "no change" edits then copied forward. A `MsgEditValidator` no longer writes a second row when begin_block has already recorded the block's commission. On an existing database, a validator whose recorded rate is stale gets a corrected row at the first block processed after upgrading.
