---
"@eclesia/core-modules-pg": patch
---

- `StakingModule` declares its dependency on `Blocks.FullBlocksModule` and refuses to set up without it, with an explanation, instead of failing on the first block insert.
- The module-account fallback for chains without the `ModuleAccounts` query tolerates names the chain does not know.
