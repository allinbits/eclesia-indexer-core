---
"@eclesia/core-modules-pg": patch
---

Fix four staking "latest row" queries reading the genesis row instead of the newest one. `getValidatorCommission`, `getValidatorDescription`, `delegate()` and `redelegate()` used `ORDER BY height DESC LIMIT 1`, which in PostgreSQL sorts NULL heights first; rows written from genesis/gentx have a NULL height, so any delegator or validator with a genesis row always read that row. The `(height DESC NULLS LAST)` index does not change query semantics. The queries now specify `NULLS LAST`, matching the voting-power and staking-params lookups in the same module.
