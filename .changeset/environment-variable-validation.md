---
"@eclesia/indexer-engine": patch
"@eclesia/core-modules-pg": patch
---

Add environment variable validation for CHAIN_PREFIX. Chain prefix is now validated at module initialization to ensure it:
- Is a non-empty string
- Starts with a lowercase letter
- Contains only lowercase letters and numbers

The validated prefix is cached in each module (StakingModule and FullBlocksModule) for consistent use throughout, replacing direct process.env access. This prevents invalid chain addresses from being generated at runtime.
