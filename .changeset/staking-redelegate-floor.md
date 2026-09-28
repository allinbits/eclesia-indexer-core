---
"@eclesia/core-modules-pg": patch
---

Staking: redelegating a whole delegation away from a slashed validator no longer leaves a small negative amount on the source. On a slashed validator the chain values a delegation's shares a few base units above the module's running total, so the source went to -1 to -9; it is now floored at zero, as `undelegate()` already was. On AtomOne mainnet this accounted for 33 negative delegations, all 0 on chain.
