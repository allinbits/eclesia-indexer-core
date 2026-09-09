---
"@eclesia/core-modules-pg": patch
---

- Bank: a spend on a denom the account has never been seen holding is recorded as a negative delta instead of a positive balance.
- Auth: module account balances are snapshotted as of the end of block 1 once block 2 starts, so block 1's own flows are no longer counted twice, and the accounts are discovered through the `ModuleAccounts` query with the well-known names as a fallback for older chains.
- Staking: `checkAndSaveValidators` skips only validators without a consensus address yet; database errors now fail the block instead of being swallowed into an aborted transaction that committed as empty.
- Staking: `updateDelegatorDelegations` follows pagination, so delegators with more than 100 delegations are refreshed completely after a slash.
