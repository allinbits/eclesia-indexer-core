---
"@eclesia/core-modules-pg": patch
---

Genesis import fixes:

- Bank: accounts holding two or more denoms no longer abort the import. Balances were serialised as one malformed `COIN[]` literal; each account's coins are now sent as JSON and unpacked server-side, which also handles empty coin lists and any denom characters.
- Auth: every genesis account shape is resolved (`address`, `base_account.address`, `base_vesting_account.base_account.address`), covering PeriodicVestingAccount, PermanentLockedAccount, EthAccount, InterchainAccount and similar wrappers. Unknown shapes are skipped with a warning instead of inserting NULL into the accounts primary key.
- Staking: `app_state.staking.validators` reads `consensus_pubkey.key` and `consensus_pubkey["@type"]` as the SDK exports them; the previous `consensus_pubkey.pubkey.key` path threw on any exported-state genesis.
- Staking: the validator cache rebuilt on restart is keyed by the active consensus address, matching every reader; it was keyed by operator address, so every validator missed on the first block after a restart.
