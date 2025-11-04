---
"@eclesia/core-modules-pg": patch
---

Replace any types in staking module with proper typed interfaces for genesis data structures including GenesisPubkey, GenesisCreateValidator, GenesisStakingParams, and GenesisValidator. Improves type safety and removes all eslint-disable comments for explicit any.