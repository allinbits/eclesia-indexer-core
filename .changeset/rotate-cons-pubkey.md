---
"@eclesia/core-modules-pg": minor
---

Handle `MsgRotateConsPubKey` in the staking module: append the new consensus key to `validators` (now carrying `operator_address`, `is_active`, and `height`), deactivate the previous key, and carry live delegations over to the new consensus address. `validator_infos.consensus_address` is dropped in favour of the operator↔consensus mapping now held on `validators`.
