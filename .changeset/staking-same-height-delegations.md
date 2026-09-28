---
"@eclesia/core-modules-pg": patch
---

Staking: delegations no longer drift when a delegator changes the same delegation more than once in a block. Each message wrote its own `staked_balances` row at that height, and the next "latest row" read (`ORDER BY height DESC LIMIT 1`) returned any of them, so later messages could build on a stale row and the error carried forward. On AtomOne mainnet 51 delegators were affected, with 37 current delegations off by about 1.14M ATONE in total and 41 showing negative amounts. The table now has one row per `(delegator, validator, height)` (migration 004 removes existing duplicates, keeping the last row written) and every write upserts. Pairs that already drifted need re-syncing from the chain.

Slashed delegations are now re-read from the chain at `end_block` instead of `begin_block`: the query returns the state after the whole block, so rows written at begin_block already included that block's delegations and the transaction handlers then added them again.

Validators the chain removes from state (unbonded with no delegator shares left) now get a `BOND_STATUS_REMOVED` row in `validator_status` at the height they leave the validator set, instead of keeping their last status forever.

Redelegating a whole delegation away from a slashed validator no longer leaves a small negative amount on the source: it is floored at zero like an undelegation.
