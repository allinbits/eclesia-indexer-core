---
"@eclesia/core-modules-pg": patch
---

Replace silent error catch in StakingModule with proper debug logging. Errors when checking validator status now log at debug level with context about the validator address and reason for the error (likely validator created in current block).
