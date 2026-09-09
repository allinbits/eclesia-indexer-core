---
"@eclesia/core-modules-pg": minor
---

Staking module fixes:

- `MsgUndelegate` is handled: the newest staked balance for the delegator/validator pair is reduced by the undelegated tokens and shares (floored at zero). `MsgCancelUnbondingDelegation` returns the tokens to the delegation. Both were previously ignored, so balances only ever grew.
- Re-creating a validator after it was removed no longer fails on a unique violation: `validator_infos` and `validators` are upserted and any other active consensus key for the operator is retired first.
- `delegate()` no longer drops a delegation when the validator is missing from the in-memory cache; it falls back to the recorded voting power and, for a validator with no recorded power yet, a 1:1 share rate.
- Commission rates and limits from `MsgCreateValidator` and `MsgEditValidator` are stored on the same decimal scale as genesis values (protobuf `LegacyDec` values are rescaled from 18-decimal integers), via the new `fromLegacyDec` helper.
- Slashing re-sync reads the unbonding period from either stored params shape (genesis snake_case or proto JSON) and treats it as seconds, not milliseconds; `MsgUpdateParams` is recorded; and when no params are stored the chain is queried once instead of failing the block.
